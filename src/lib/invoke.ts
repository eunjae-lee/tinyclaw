import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, StreamChunkCallback } from './types';
import { SCRIPT_DIR, TINYCLAW_CONFIG_HOME, CLI_TIMEOUT_MS, resolveClaudeModel, resolveCodexModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory } from './agent-setup';
import { getMemoryForInjection, writeMemoryTempFile, cleanupMemoryTmpFiles } from '../memory/read';
import { getSession, createSession } from './session-store';

export async function runCommand(command: string, args: string[], cwd?: string, env?: Record<string, string>, timeoutMs?: number, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            env: env ? { ...process.env, ...env } : undefined,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let aborted = false;

        const effectiveTimeout = timeoutMs ?? CLI_TIMEOUT_MS;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            // Force kill after 5 seconds if SIGTERM doesn't work
            setTimeout(() => {
                if (!child.killed) {
                    child.kill('SIGKILL');
                }
            }, 5000);
        }, effectiveTimeout);

        if (signal) {
            const onAbort = () => {
                aborted = true;
                child.kill('SIGTERM');
                setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
            };
            if (signal.aborted) {
                onAbort();
            } else {
                signal.addEventListener('abort', onAbort, { once: true });
                child.on('close', () => signal.removeEventListener('abort', onAbort));
            }
        }

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (aborted) {
                reject(new Error('Cancelled by user'));
                return;
            }
            if (timedOut) {
                reject(new Error(`Command timed out after ${effectiveTimeout}ms`));
                return;
            }
            if (code === 0) {
                resolve(stdout);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}


export async function runCommandStreaming(
    command: string,
    args: string[],
    onChunk: StreamChunkCallback,
    cwd?: string,
    env?: Record<string, string>,
    timeoutMs?: number,
    signal?: AbortSignal
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            env: env ? { ...process.env, ...env } : undefined,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let accumulated = '';
        let resultText = '';
        let stderr = '';
        let timedOut = false;
        let aborted = false;
        let lineBuffer = '';

        const effectiveTimeout = timeoutMs ?? CLI_TIMEOUT_MS;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => {
                if (!child.killed) {
                    child.kill('SIGKILL');
                }
            }, 5000);
        }, effectiveTimeout);

        if (signal) {
            const onAbort = () => {
                aborted = true;
                child.kill('SIGTERM');
                setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
            };
            if (signal.aborted) {
                onAbort();
            } else {
                signal.addEventListener('abort', onAbort, { once: true });
                child.on('close', () => signal.removeEventListener('abort', onAbort));
            }
        }

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            lineBuffer += chunk;
            const lines = lineBuffer.split('\n');
            // Keep the last (potentially incomplete) line in the buffer
            lineBuffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);
                    if (event.type === 'assistant' && event.message?.content) {
                        // Initial assistant message — extract text blocks
                        for (const block of event.message.content) {
                            if (block.type === 'text' && block.text) {
                                accumulated += block.text;
                            }
                        }
                        onChunk(accumulated);
                    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                        accumulated += event.delta.text;
                        onChunk(accumulated);
                    } else if (event.type === 'result') {
                        resultText = event.result || accumulated;
                    }
                } catch {
                    // Skip non-JSON lines
                }
            }
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timer);

            // Process any remaining data in the line buffer
            if (lineBuffer.trim()) {
                try {
                    const event = JSON.parse(lineBuffer);
                    if (event.type === 'result') {
                        resultText = event.result || accumulated;
                    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                        accumulated += event.delta.text;
                    }
                } catch {
                    // Not valid JSON — ignore
                }
            }

            if (aborted) {
                reject(new Error('Cancelled by user'));
                return;
            }
            if (timedOut) {
                reject(new Error(`Command timed out after ${effectiveTimeout}ms`));
                return;
            }
            if (code === 0) {
                resolve(resultText || accumulated);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
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
    messageId?: string,
    sessionKey?: string,
    onChunk?: StreamChunkCallback,
    signal?: AbortSignal
): Promise<string> {
    // Ensure agent directory exists with config files
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

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

        const codexOutput = await runCommand('codex', codexArgs, workingDir, undefined, undefined, signal);

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
        if (onChunk) {
            claudeArgs.push('--output-format', 'stream-json');
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

        // Helper: run claude with streaming or batch depending on onChunk
        const runClaude = (args: string[]) =>
            onChunk
                ? runCommandStreaming('claude', args, onChunk, workingDir, env, undefined, signal)
                : runCommand('claude', args, workingDir, env, undefined, signal);

        if (sessionKey) {
            if (shouldReset) {
                const sessionId = createSession(sessionKey, agentId);
                log('INFO', `Created new session ${sessionId} for key ${sessionKey} (reset)`);
                claudeArgs.push('--session-id', sessionId, '-p', message);
                return await runClaude(claudeArgs);
            }

            const existing = getSession(sessionKey);
            if (existing) {
                // Resume existing session
                const resumeArgs = [...claudeArgs, '--resume', existing.sessionId, '-p', message];
                try {
                    return await runClaude(resumeArgs);
                } catch (err) {
                    const errMsg = (err as Error).message || '';
                    if (/session.*not found/i.test(errMsg) || /no such session/i.test(errMsg)) {
                        // Session was deleted/expired — create a new one
                        const sessionId = createSession(sessionKey, agentId);
                        log('INFO', `Session ${existing.sessionId} not found, created new session ${sessionId}`);
                        const newArgs = [...claudeArgs, '--session-id', sessionId, '-p', message];
                        return await runClaude(newArgs);
                    }
                    // Transient error — propagate instead of destroying the session
                    throw err;
                }
            }

            // No existing mapping — create a new session
            const sessionId = createSession(sessionKey, agentId);
            log('INFO', `Created new session ${sessionId} for key ${sessionKey}`);
            claudeArgs.push('--session-id', sessionId, '-p', message);
            return await runClaude(claudeArgs);
        }

        if (continueConversation) {
            // Fallback: continue last session (backward compat when no sessionKey)
            claudeArgs.push('-c');
        }

        claudeArgs.push('-p', message);
        return await runClaude(claudeArgs);
    }
}
