/**
 * Core queue processing logic extracted from queue-processor.ts.
 * These functions contain the main message processing logic without
 * side effects (setInterval, process.on, fs.mkdirSync at module level).
 */

import fs from 'fs';
import path from 'path';
import { MessageData, ResponseData, ChainStep, TeamConfig } from './types';
import {
    QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING,
    QUEUE_DEAD_LETTER, MAX_RETRY_COUNT,
    RESET_FLAG, CHATS_DIR,
    TINYCLAW_CONFIG_WORKSPACE,
    getSettings, getAgents, getTeams
} from './config';
import { log, emitEvent } from './logging';
import { parseAgentRouting, findTeamForAgent, getAgentResetFlag, extractTeammateMentions } from './routing';
import { invokeAgent } from './invoke';

/**
 * Process a single message file from the incoming queue.
 */
export async function processMessage(messageFile: string): Promise<void> {
    const processingFile = path.join(QUEUE_PROCESSING, path.basename(messageFile));

    try {
        // Move to processing to mark as in-progress
        fs.renameSync(messageFile, processingFile);

        // Read message
        const messageData: MessageData = JSON.parse(fs.readFileSync(processingFile, 'utf8'));
        const { channel, sender, message: rawMessage, timestamp, messageId, sessionKey } = messageData;

        log('INFO', `Processing [${channel}] from ${sender}: ${rawMessage.substring(0, 50)}...`);
        emitEvent('message_received', { channel, sender, message: rawMessage.substring(0, 120), messageId });

        // Get settings, agents, and teams
        const settings = getSettings();
        const agents = getAgents(settings);
        const teams = getTeams(settings);

        // Get workspace path from settings
        const workspacePath = settings?.workspace?.path || TINYCLAW_CONFIG_WORKSPACE;

        // Route message to agent (or team)
        let agentId: string;
        let message: string;
        let isTeamRouted = false;

        if (messageData.agent && agents[messageData.agent]) {
            // Pre-routed by channel client
            agentId = messageData.agent;
            message = rawMessage;
        } else {
            // Parse !agent or !team prefix
            const routing = parseAgentRouting(rawMessage, agents, teams);
            agentId = routing.agentId;
            message = routing.message;
            isTeamRouted = !!routing.isTeam;
        }

        // Easter egg: Handle multiple agent mentions
        if (agentId === 'error') {
            log('INFO', `Multiple agents detected, sending easter egg message`);

            // Send error message directly as response
            const responseFile = path.join(QUEUE_OUTGOING, path.basename(processingFile));
            const responseData: ResponseData = {
                channel,
                sender,
                message: message, // Contains the easter egg message
                originalMessage: rawMessage,
                timestamp: Date.now(),
                messageId,
            };

            fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));
            fs.unlinkSync(processingFile);
            log('INFO', `✓ Easter egg sent to ${sender}`);
            return;
        }

        // Fall back to default if agent not found
        if (!agents[agentId]) {
            agentId = 'default';
            message = rawMessage;
        }

        // Final fallback: use first available agent if no default
        if (!agents[agentId]) {
            agentId = Object.keys(agents)[0];
        }

        const agent = agents[agentId];
        log('INFO', `Routing to agent: ${agent.name} (${agentId}) [${agent.provider}/${agent.model}]`);
        emitEvent('agent_routed', { agentId, agentName: agent.name, provider: agent.provider, model: agent.model, isTeamRouted });

        // Determine team context
        // If routed via !team_id, use that team. Otherwise check if agent belongs to a team.
        let teamContext: { teamId: string; team: TeamConfig } | null = null;
        if (isTeamRouted) {
            // Find which team was targeted — the agent was resolved from a team's leader
            for (const [tid, t] of Object.entries(teams)) {
                if (t.leader_agent === agentId && t.agents.includes(agentId)) {
                    teamContext = { teamId: tid, team: t };
                    break;
                }
            }
        }
        if (!teamContext) {
            // Check if the directly-addressed agent belongs to a team
            teamContext = findTeamForAgent(agentId, teams);
        }

        // Check for reset (per-agent or global)
        const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
        const shouldReset = fs.existsSync(RESET_FLAG) || fs.existsSync(agentResetFlag);

        if (shouldReset) {
            // Clean up both flags
            if (fs.existsSync(RESET_FLAG)) fs.unlinkSync(RESET_FLAG);
            if (fs.existsSync(agentResetFlag)) fs.unlinkSync(agentResetFlag);
        }

        let finalResponse: string;
        const allFiles = new Set<string>();

        if (!teamContext) {
            // No team context — single agent invocation (backward compatible)
            try {
                finalResponse = await invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, teams, messageId, sessionKey);
            } catch (error) {
                const provider = agent.provider || 'anthropic';
                log('ERROR', `${provider === 'openai' ? 'Codex' : 'Claude'} error (agent: ${agentId}): ${(error as Error).message}`);
                finalResponse = "Sorry, I encountered an error processing your request. Please check the queue logs.";
            }
        } else {
            // Team context — chain execution
            log('INFO', `Team context: ${teamContext.team.name} (@${teamContext.teamId})`);
            emitEvent('team_chain_start', { teamId: teamContext.teamId, teamName: teamContext.team.name, agents: teamContext.team.agents, leader: teamContext.team.leader_agent });

            const chainSteps: ChainStep[] = [];
            let currentAgentId = agentId;
            let currentMessage = message;

            // Chain loop — continues until agent responds without mentioning a teammate
            while (true) {
                const currentAgent = agents[currentAgentId];
                if (!currentAgent) {
                    log('ERROR', `Agent ${currentAgentId} not found during chain execution`);
                    break;
                }

                log('INFO', `Chain step ${chainSteps.length + 1}: invoking @${currentAgentId}`);
                emitEvent('chain_step_start', { teamId: teamContext.teamId, step: chainSteps.length + 1, agentId: currentAgentId, agentName: currentAgent.name });

                // Determine if this specific agent needs reset
                const currentResetFlag = getAgentResetFlag(currentAgentId, workspacePath);
                const currentShouldReset = chainSteps.length === 0
                    ? shouldReset
                    : fs.existsSync(currentResetFlag);

                if (currentShouldReset && fs.existsSync(currentResetFlag)) {
                    fs.unlinkSync(currentResetFlag);
                }

                let stepResponse: string;
                try {
                    stepResponse = await invokeAgent(currentAgent, currentAgentId, currentMessage, workspacePath, currentShouldReset, agents, teams, messageId, sessionKey);
                } catch (error) {
                    const provider = currentAgent.provider || 'anthropic';
                    log('ERROR', `${provider === 'openai' ? 'Codex' : 'Claude'} error (agent: ${currentAgentId}): ${(error as Error).message}`);
                    stepResponse = "Sorry, I encountered an error processing this request.";
                }

                chainSteps.push({ agentId: currentAgentId, response: stepResponse });
                emitEvent('chain_step_done', { teamId: teamContext.teamId, step: chainSteps.length, agentId: currentAgentId, responseLength: stepResponse.length, responseText: stepResponse });

                // Collect files from this step
                const stepFileRegex = /\[send_file:\s*([^\]]+)\]/g;
                let stepFileMatch: RegExpExecArray | null;
                while ((stepFileMatch = stepFileRegex.exec(stepResponse)) !== null) {
                    const filePath = stepFileMatch[1].trim();
                    if (fs.existsSync(filePath)) {
                        allFiles.add(filePath);
                    }
                }

                // Check if response mentions teammates
                const teammateMentions = extractTeammateMentions(
                    stepResponse, currentAgentId, teamContext.teamId, teams, agents
                );

                if (teammateMentions.length === 0) {
                    // No teammate mentioned — chain ends naturally
                    log('INFO', `Chain ended after ${chainSteps.length} step(s) — no teammate mentioned`);
                    emitEvent('team_chain_end', { teamId: teamContext.teamId, totalSteps: chainSteps.length, agents: chainSteps.map(s => s.agentId) });
                    break;
                }

                if (teammateMentions.length === 1) {
                    // Single handoff — sequential chain (existing behavior)
                    const mention = teammateMentions[0];
                    log('INFO', `@${currentAgentId} mentioned @${mention.teammateId} — continuing chain`);
                    emitEvent('chain_handoff', { teamId: teamContext.teamId, fromAgent: currentAgentId, toAgent: mention.teammateId, step: chainSteps.length });
                    currentAgentId = mention.teammateId;
                    currentMessage = `[Message from teammate @${chainSteps[chainSteps.length - 1].agentId}]:\n${mention.message}`;
                } else {
                    // Fan-out — invoke multiple teammates in parallel
                    log('INFO', `@${currentAgentId} mentioned ${teammateMentions.length} teammates — fan-out`);
                    for (const mention of teammateMentions) {
                        emitEvent('chain_handoff', { teamId: teamContext.teamId, fromAgent: currentAgentId, toAgent: mention.teammateId, step: chainSteps.length });
                    }

                    const fanOutResults = await Promise.all(
                        teammateMentions.map(async (mention) => {
                            const mAgent = agents[mention.teammateId];
                            if (!mAgent) return { agentId: mention.teammateId, response: `Error: agent ${mention.teammateId} not found` };

                            const mResetFlag = getAgentResetFlag(mention.teammateId, workspacePath);
                            const mShouldReset = fs.existsSync(mResetFlag);
                            if (mShouldReset) fs.unlinkSync(mResetFlag);

                            emitEvent('chain_step_start', { teamId: teamContext!.teamId, step: chainSteps.length + 1, agentId: mention.teammateId, agentName: mAgent.name });

                            let mResponse: string;
                            try {
                                const mMessage = `[Message from teammate @${currentAgentId}]:\n${mention.message}`;
                                mResponse = await invokeAgent(mAgent, mention.teammateId, mMessage, workspacePath, mShouldReset, agents, teams, messageId, sessionKey);
                            } catch (error) {
                                log('ERROR', `Fan-out error (agent: ${mention.teammateId}): ${(error as Error).message}`);
                                mResponse = "Sorry, I encountered an error processing this request.";
                            }

                            emitEvent('chain_step_done', { teamId: teamContext!.teamId, step: chainSteps.length + 1, agentId: mention.teammateId, responseLength: mResponse.length, responseText: mResponse });
                            return { agentId: mention.teammateId, response: mResponse };
                        })
                    );

                    for (const result of fanOutResults) {
                        chainSteps.push(result);

                        // Collect files from fan-out responses
                        const fanFileRegex = /\[send_file:\s*([^\]]+)\]/g;
                        let fanFileMatch: RegExpExecArray | null;
                        while ((fanFileMatch = fanFileRegex.exec(result.response)) !== null) {
                            const filePath = fanFileMatch[1].trim();
                            if (fs.existsSync(filePath)) allFiles.add(filePath);
                        }
                    }

                    log('INFO', `Fan-out complete — ${fanOutResults.length} responses collected`);
                    emitEvent('team_chain_end', { teamId: teamContext.teamId, totalSteps: chainSteps.length, agents: chainSteps.map(s => s.agentId) });
                    break;
                }
            }

            // Aggregate responses
            if (chainSteps.length === 1) {
                finalResponse = chainSteps[0].response;
            } else {
                finalResponse = chainSteps
                    .map(step => `@${step.agentId}: ${step.response}`)
                    .join('\n\n---\n\n');
            }

            // Write chain chat history to .tinyclaw/chats
            try {
                const teamChatsDir = path.join(CHATS_DIR, teamContext.teamId);
                if (!fs.existsSync(teamChatsDir)) {
                    fs.mkdirSync(teamChatsDir, { recursive: true });
                }
                const chatLines: string[] = [];
                chatLines.push(`# Team Chain: ${teamContext.team.name} (@${teamContext.teamId})`);
                chatLines.push(`**Date:** ${new Date().toISOString()}`);
                chatLines.push(`**Channel:** ${channel} | **Sender:** ${sender}`);
                chatLines.push(`**Steps:** ${chainSteps.length}`);
                chatLines.push('');
                chatLines.push('---');
                chatLines.push('');
                chatLines.push(`## User Message`);
                chatLines.push('');
                chatLines.push(rawMessage);
                chatLines.push('');
                for (let i = 0; i < chainSteps.length; i++) {
                    const step = chainSteps[i];
                    const stepAgent = agents[step.agentId];
                    const stepLabel = stepAgent ? `${stepAgent.name} (@${step.agentId})` : `@${step.agentId}`;
                    chatLines.push('---');
                    chatLines.push('');
                    chatLines.push(`## Step ${i + 1}: ${stepLabel}`);
                    chatLines.push('');
                    chatLines.push(step.response);
                    chatLines.push('');
                }
                const now = new Date();
                const dateTime = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
                const chatFilename = `${dateTime}.md`;
                fs.writeFileSync(path.join(teamChatsDir, chatFilename), chatLines.join('\n'));
                log('INFO', `Chain chat history saved to ${chatFilename}`);
            } catch (e) {
                log('ERROR', `Failed to save chain chat history: ${(e as Error).message}`);
            }
        }

        // Detect file references in the response: [send_file: /path/to/file]
        finalResponse = finalResponse.trim();
        const outboundFilesSet = new Set<string>(allFiles);
        const fileRefRegex = /\[send_file:\s*([^\]]+)\]/g;
        let fileMatch: RegExpExecArray | null;
        while ((fileMatch = fileRefRegex.exec(finalResponse)) !== null) {
            const filePath = fileMatch[1].trim();
            if (fs.existsSync(filePath)) {
                outboundFilesSet.add(filePath);
            }
        }
        const outboundFiles = Array.from(outboundFilesSet);

        // Remove the [send_file: ...] tags from the response text
        if (outboundFiles.length > 0) {
            finalResponse = finalResponse.replace(fileRefRegex, '').trim();
        }

        // Limit response length after tags are parsed and removed
        if (finalResponse.length > 4000) {
            finalResponse = finalResponse.substring(0, 3900) + '\n\n[Response truncated...]';
        }

        // Write response to outgoing queue
        const responseData: ResponseData = {
            channel,
            sender,
            message: finalResponse,
            originalMessage: rawMessage,
            timestamp: Date.now(),
            messageId,
            agent: agentId,
            files: outboundFiles.length > 0 ? outboundFiles : undefined,
        };

        // For heartbeat messages, write to a separate location (they handle their own responses)
        const responseFile = channel === 'heartbeat'
            ? path.join(QUEUE_OUTGOING, `${messageId}.json`)
            : path.join(QUEUE_OUTGOING, `${channel}_${messageId}_${Date.now()}.json`);

        fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));

        log('INFO', `✓ Response ready [${channel}] ${sender} via agent:${agentId} (${finalResponse.length} chars)`);
        emitEvent('response_ready', { channel, sender, agentId, responseLength: finalResponse.length, responseText: finalResponse, messageId });

        // Clean up processing file
        fs.unlinkSync(processingFile);

    } catch (error) {
        log('ERROR', `Processing error: ${(error as Error).message}`);

        // Move back to incoming for retry, or to dead-letter if retries exhausted
        if (fs.existsSync(processingFile)) {
            try {
                let messageData: MessageData;
                try {
                    messageData = JSON.parse(fs.readFileSync(processingFile, 'utf8'));
                } catch {
                    messageData = { channel: 'unknown', sender: 'unknown', message: '', timestamp: 0, messageId: 'unknown' };
                }

                const retryCount = (messageData.retryCount || 0) + 1;

                if (retryCount >= MAX_RETRY_COUNT) {
                    // Move to dead-letter directory
                    if (!fs.existsSync(QUEUE_DEAD_LETTER)) {
                        fs.mkdirSync(QUEUE_DEAD_LETTER, { recursive: true });
                    }
                    const deadLetterFile = path.join(QUEUE_DEAD_LETTER, path.basename(processingFile));
                    messageData.retryCount = retryCount;
                    fs.writeFileSync(deadLetterFile, JSON.stringify(messageData, null, 2));
                    fs.unlinkSync(processingFile);
                    log('ERROR', `Message moved to dead-letter after ${retryCount} retries: ${path.basename(processingFile)} — ${(error as Error).message}`);
                } else {
                    // Increment retry count and move back to incoming
                    messageData.retryCount = retryCount;
                    fs.writeFileSync(processingFile, JSON.stringify(messageData, null, 2));
                    fs.renameSync(processingFile, messageFile);
                    log('WARN', `Message returned to incoming (retry ${retryCount}/${MAX_RETRY_COUNT}): ${path.basename(processingFile)}`);
                }
            } catch (e) {
                log('ERROR', `Failed to handle retry/dead-letter: ${(e as Error).message}`);
            }
        }
    }
}

/**
 * Recover files stuck in the processing directory.
 * Files older than the threshold are moved back to incoming with retryCount incremented,
 * or to dead-letter if retries are exhausted.
 * Called on startup and periodically by the queue processor.
 */
export function recoverStuckFiles(staleThresholdMs: number = 15 * 60 * 1000): number {
    let recovered = 0;
    try {
        if (!fs.existsSync(QUEUE_PROCESSING)) return 0;

        const files = fs.readdirSync(QUEUE_PROCESSING).filter(f => f.endsWith('.json'));
        const now = Date.now();

        for (const file of files) {
            const filePath = path.join(QUEUE_PROCESSING, file);
            try {
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > staleThresholdMs) {
                    let messageData: MessageData;
                    try {
                        messageData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    } catch {
                        messageData = { channel: 'unknown', sender: 'unknown', message: '', timestamp: 0, messageId: 'unknown' };
                    }

                    const retryCount = (messageData.retryCount || 0) + 1;

                    if (retryCount >= MAX_RETRY_COUNT) {
                        if (!fs.existsSync(QUEUE_DEAD_LETTER)) {
                            fs.mkdirSync(QUEUE_DEAD_LETTER, { recursive: true });
                        }
                        messageData.retryCount = retryCount;
                        const deadLetterFile = path.join(QUEUE_DEAD_LETTER, file);
                        fs.writeFileSync(deadLetterFile, JSON.stringify(messageData, null, 2));
                        fs.unlinkSync(filePath);
                        log('WARN', `Stuck file moved to dead-letter (retry ${retryCount}/${MAX_RETRY_COUNT}): ${file}`);
                    } else {
                        messageData.retryCount = retryCount;
                        const incomingFile = path.join(QUEUE_INCOMING, file);
                        fs.writeFileSync(incomingFile, JSON.stringify(messageData, null, 2));
                        fs.unlinkSync(filePath);
                        log('WARN', `Recovered stuck file (retry ${retryCount}/${MAX_RETRY_COUNT}): ${file}`);
                    }
                    recovered++;
                }
            } catch (e) {
                log('ERROR', `Failed to recover stuck file ${file}: ${(e as Error).message}`);
            }
        }
    } catch (e) {
        log('ERROR', `recoverStuckFiles error: ${(e as Error).message}`);
    }
    return recovered;
}

/**
 * Peek at a message file to determine which agent it's routed to.
 * Also resolves team IDs to their leader agent.
 */
export function peekAgentId(filePath: string): string {
    try {
        const messageData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const settings = getSettings();
        const agents = getAgents(settings);
        const teams = getTeams(settings);

        // Check for pre-routed agent
        if (messageData.agent && agents[messageData.agent]) {
            return messageData.agent;
        }

        // Parse !agent_id or !team_id prefix
        const routing = parseAgentRouting(messageData.message || '', agents, teams);
        return routing.agentId || 'default';
    } catch {
        return 'default';
    }
}
