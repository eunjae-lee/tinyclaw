import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig, Settings } from './types';
import { SCRIPT_DIR, TINYCLAW_CONFIG_HOME, resolveClaudeModel, resolveCodexModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent-setup';
import { getMemoryForInjection, writeMemoryTempFile, cleanupMemoryTmpFiles } from '../memory/read';

export async function runCommand(command: string, args: string[], cwd?: string, env?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            env: env ? { ...process.env, ...env } : undefined,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}

/**
 * Generate a deterministic UUID from a string key using SHA-256.
 * Formatted as UUID v4 structure but with deterministic content.
 */
export function deterministicUUID(key: string): string {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        '4' + hash.slice(13, 16),
        ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
        hash.slice(20, 32),
    ].join('-');
}

/**
 * Invoke a single agent with a message. Contains all Claude/Codex invocation logic.
 * Returns the raw response text.
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {},
    messageId?: string,
    sessionKey?: string
): Promise<string> {
    // Ensure agent directory exists with config files
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

    // Update AGENTS.md with current teammate info
    updateAgentTeammates(agentDir, agentId, agents, teams);

    // Resolve working directory
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const provider = agent.provider || 'anthropic';

    if (provider === 'openai') {
        log('INFO', `Using Codex CLI (agent: ${agentId})`);

        const shouldResume = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting Codex conversation for agent: ${agentId}`);
        }

        const modelId = resolveCodexModel(agent.model);
        const codexArgs = ['exec'];
        if (shouldResume) {
            codexArgs.push('resume', '--last');
        }
        if (modelId) {
            codexArgs.push('--model', modelId);
        }
        codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

        const codexOutput = await runCommand('codex', codexArgs, workingDir);

        // Parse JSONL output and extract final agent_message
        let response = '';
        const lines = codexOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                    response = json.item.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from Codex.';
    } else {
        // Default to Claude (Anthropic)
        log('INFO', `Using Claude provider (agent: ${agentId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting conversation for agent: ${agentId}`);
        }

        const modelId = resolveClaudeModel(agent.model);

        const claudeArgs: string[] = ['--permission-mode', 'default'];
        if (modelId) {
            claudeArgs.push('--model', modelId);
        }
        // Memory injection
        try {
            cleanupMemoryTmpFiles();
            const memoryContent = getMemoryForInjection();
            if (memoryContent?.trim()) {
                const memoryFile = writeMemoryTempFile(memoryContent, agentId);
                claudeArgs.push('--append-system-prompt-file', memoryFile);
            }
        } catch (e) {
            log('WARN', `Memory injection failed: ${(e as Error).message}`);
        }

        const env = {
            TINYCLAW_AGENT_ID: agentId,
            TINYCLAW_CONFIG_HOME,
            ...(messageId ? { TINYCLAW_MESSAGE_ID: messageId } : {}),
        };

        if (sessionKey) {
            const sessionId = deterministicUUID(`${agentId}:${sessionKey}`);
            if (shouldReset) {
                // Reset: start fresh session with this ID
                claudeArgs.push('--session-id', sessionId, '-p', message);
                return await runCommand('claude', claudeArgs, workingDir, env);
            }

            // Try to resume existing session; if it fails (e.g. session doesn't exist), create it
            const resumeArgs = [...claudeArgs, '--resume', sessionId, '-p', message];
            try {
                return await runCommand('claude', resumeArgs, workingDir, env);
            } catch {
                log('INFO', `Session ${sessionId} not found, creating new session`);
                const newArgs = [...claudeArgs, '--session-id', sessionId, '-p', message];
                return await runCommand('claude', newArgs, workingDir, env);
            }
        }

        if (continueConversation) {
            // Fallback: continue last session (backward compat when no sessionKey)
            claudeArgs.push('-c');
        }

        claudeArgs.push('-p', message);
        return await runCommand('claude', claudeArgs, workingDir, env);
    }
}
