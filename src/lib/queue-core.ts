/**
 * Core queue processing logic extracted from queue-processor.ts.
 * These functions contain the main message processing logic without
 * side effects (setInterval, process.on, fs.mkdirSync at module level).
 */

import fs from 'fs';
import path from 'path';
import { MessageData, ResponseData, StreamingData } from './types';
import {
    QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING,
    QUEUE_DEAD_LETTER, MAX_RETRY_COUNT,
    RESET_FLAG,
    TINYCLAW_CONFIG_WORKSPACE,
    getSettings, getAgents
} from './config';
import { log, emitEvent } from './logging';
import { parseAgentRouting, getAgentResetFlag } from './routing';
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

        // Get settings and agents
        const settings = getSettings();
        const agents = getAgents(settings);

        // Get workspace path from settings
        const workspacePath = settings?.workspace?.path || TINYCLAW_CONFIG_WORKSPACE;

        // Route message to agent
        let agentId: string;
        let message: string;

        if (messageData.agent && agents[messageData.agent]) {
            // Pre-routed by channel client
            agentId = messageData.agent;
            message = rawMessage;
        } else {
            // Parse !agent prefix
            const routing = parseAgentRouting(rawMessage, agents);
            agentId = routing.agentId;
            message = routing.message;
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
        emitEvent('agent_routed', { agentId, agentName: agent.name, provider: agent.provider, model: agent.model });

        // Check for reset (per-agent or global)
        const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
        const shouldReset = fs.existsSync(RESET_FLAG) || fs.existsSync(agentResetFlag);

        if (shouldReset) {
            // Clean up both flags
            if (fs.existsSync(RESET_FLAG)) fs.unlinkSync(RESET_FLAG);
            if (fs.existsSync(agentResetFlag)) fs.unlinkSync(agentResetFlag);
        }

        // Set up streaming callback for real-time partial responses
        const streamingFile = path.join(QUEUE_OUTGOING, `discord_${messageId}.streaming`);
        let lastStreamWrite = 0;
        const STREAM_THROTTLE_MS = 1000;

        const onChunk = (accumulated: string) => {
            const now = Date.now();
            if (now - lastStreamWrite < STREAM_THROTTLE_MS) return;
            lastStreamWrite = now;

            try {
                const streamingData: StreamingData = {
                    status: 'streaming',
                    channel,
                    sender,
                    messageId,
                    partial: accumulated,
                    agent: agentId,
                    timestamp: now,
                };
                fs.writeFileSync(streamingFile, JSON.stringify(streamingData));
            } catch (e) {
                log('WARN', `Failed to write streaming file: ${(e as Error).message}`);
            }
        };

        let finalResponse: string;

        try {
            finalResponse = await invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, messageId, sessionKey, onChunk);
        } catch (error) {
            const provider = agent.provider || 'anthropic';
            log('ERROR', `${provider === 'openai' ? 'Codex' : 'Claude'} error (agent: ${agentId}): ${(error as Error).message}`);
            finalResponse = "Sorry, I encountered an error processing your request. Please check the queue logs.";
        } finally {
            // Clean up streaming file
            try {
                if (fs.existsSync(streamingFile)) fs.unlinkSync(streamingFile);
            } catch { /* ignore */ }
        }

        // Detect file references in the response: [send_file: /path/to/file]
        finalResponse = finalResponse.trim();
        const outboundFilesSet = new Set<string>();
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
 */
export function peekAgentId(filePath: string): string {
    try {
        const messageData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const settings = getSettings();
        const agents = getAgents(settings);

        // Check for pre-routed agent
        if (messageData.agent && agents[messageData.agent]) {
            return messageData.agent;
        }

        // Parse !agent_id prefix
        const routing = parseAgentRouting(messageData.message || '', agents);
        return routing.agentId || 'default';
    } catch {
        return 'default';
    }
}
