import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentConfig } from '../lib/types';

// Mock child_process.spawn to avoid real process execution
vi.mock('child_process', () => ({
    spawn: vi.fn(() => {
        const EventEmitter = require('events');
        const { Readable } = require('stream');

        const stdout = new Readable({ read() {} });
        const stderr = new Readable({ read() {} });
        const child = new EventEmitter();
        child.stdout = stdout;
        child.stderr = stderr;
        child.stdout.setEncoding = vi.fn();
        child.stderr.setEncoding = vi.fn();

        // Emit data and close on next tick
        process.nextTick(() => {
            stdout.push('mocked response');
            stdout.push(null);
            child.emit('close', 0);
        });

        return child;
    }),
}));

vi.mock('../lib/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/config')>();
    return {
        ...actual,
    };
});

vi.mock('../lib/agent-setup', () => ({
    ensureAgentDirectory: vi.fn(),
}));

vi.mock('../lib/logging', () => ({
    log: vi.fn(),
}));

vi.mock('../lib/session-store', () => ({
    getSession: vi.fn(),
    createSession: vi.fn(() => 'mock-session-uuid'),
}));

import { spawn } from 'child_process';
import { invokeAgent, runCommand, runCommandStreaming } from '../lib/invoke';
import { getSession, createSession } from '../lib/session-store';

const mockedSpawn = vi.mocked(spawn);
const mockedGetSession = vi.mocked(getSession);
const mockedCreateSession = vi.mocked(createSession);

describe('invokeAgent - Claude argument construction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function getSpawnArgs(): { command: string; args: string[] } {
        const call = mockedSpawn.mock.calls[0];
        return { command: call[0] as string, args: call[1] as string[] };
    }

    it('does not pass --allowedTools (permissions handled by .claude/settings.json)', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true);

        const { command, args } = getSpawnArgs();
        expect(command).toBe('claude');
        expect(args).not.toContain('--allowedTools');
    });

    it('passes --permission-mode default to enforce permissions in print mode', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true);

        const { args } = getSpawnArgs();
        const modeIndex = args.indexOf('--permission-mode');
        expect(modeIndex).toBeGreaterThan(-1);
        expect(args[modeIndex + 1]).toBe('default');
    });

    it('does not include --dangerously-skip-permissions', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true);

        const { args } = getSpawnArgs();
        expect(args).not.toContain('--dangerously-skip-permissions');
    });

    it('includes -c flag when continuing conversation', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', false);

        const { args } = getSpawnArgs();
        expect(args).toContain('-c');
    });

    it('does not include -c flag when resetting conversation', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true);

        const { args } = getSpawnArgs();
        expect(args).not.toContain('-c');
    });

    it('includes --model flag with resolved model ID', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true);

        const { args } = getSpawnArgs();
        const modelIndex = args.indexOf('--model');
        expect(modelIndex).toBeGreaterThan(-1);
        expect(args[modelIndex + 1]).toBe('claude-sonnet-4-5');
    });
});

describe('invokeAgent - environment variables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function getSpawnOptions(): any {
        return mockedSpawn.mock.calls[0][2];
    }

    it('passes TINYCLAW_AGENT_ID env var to Claude spawn', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true);

        const options = getSpawnOptions();
        expect(options.env.TINYCLAW_AGENT_ID).toBe('coder');
    });

    it('passes TINYCLAW_CONFIG_HOME env var to Claude spawn', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true);

        const options = getSpawnOptions();
        expect(options.env.TINYCLAW_CONFIG_HOME).toBeDefined();
        expect(typeof options.env.TINYCLAW_CONFIG_HOME).toBe('string');
    });

    it('does not pass TINYCLAW_AGENT_ID for codex provider', async () => {
        const agent: AgentConfig = {
            name: 'CodexAgent',
            provider: 'openai',
            model: 'gpt-5.3-codex',
            working_directory: '/tmp/codex',
        };

        await invokeAgent(agent, 'codex-agent', 'hello', '/tmp/workspace', true);

        const options = getSpawnOptions();
        // Codex doesn't get the custom env (env should be undefined)
        expect(options.env).toBeUndefined();
    });
});

describe('invokeAgent - Codex provider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function getSpawnArgs(): { command: string; args: string[] } {
        const call = mockedSpawn.mock.calls[0];
        return { command: call[0] as string, args: call[1] as string[] };
    }

    it('uses codex CLI for openai provider', async () => {
        const agent: AgentConfig = {
            name: 'CodexAgent',
            provider: 'openai',
            model: 'gpt-5.3-codex',
            working_directory: '/tmp/codex',
        };

        await invokeAgent(agent, 'codex-agent', 'hello', '/tmp/workspace', true);

        const { command, args } = getSpawnArgs();
        expect(command).toBe('codex');
        expect(args).toContain('exec');
    });

    it('does not include --allowedTools for codex provider', async () => {
        const agent: AgentConfig = {
            name: 'CodexAgent',
            provider: 'openai',
            model: 'gpt-5.3-codex',
            working_directory: '/tmp/codex',
        };

        await invokeAgent(agent, 'codex-agent', 'hello', '/tmp/workspace', true);

        const { args } = getSpawnArgs();
        expect(args).not.toContain('--allowedTools');
    });
});

describe('invokeAgent - session isolation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Restore default spawn mock (mockImplementation leaks across tests)
        mockedSpawn.mockImplementation((() => {
            const EventEmitter = require('events');
            const { Readable } = require('stream');

            const stdout = new Readable({ read() {} });
            const stderr = new Readable({ read() {} });
            const child = new EventEmitter();
            child.stdout = stdout;
            child.stderr = stderr;
            child.stdout.setEncoding = vi.fn();
            child.stderr.setEncoding = vi.fn();

            process.nextTick(() => {
                stdout.push('mocked response');
                stdout.push(null);
                child.emit('close', 0);
            });

            return child;
        }) as any);
    });

    function getSpawnArgs(callIndex = 0): { command: string; args: string[] } {
        const call = mockedSpawn.mock.calls[callIndex];
        return { command: call[0] as string, args: call[1] as string[] };
    }

    it('resumes existing session from session-store when sessionKey provided', async () => {
        mockedGetSession.mockReturnValue({ sessionId: 'stored-uuid-123', agentId: 'coder', createdAt: Date.now() });

        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', false, {}, undefined, 'thread_123');

        expect(mockedGetSession).toHaveBeenCalledWith('thread_123');
        const { args } = getSpawnArgs();
        const resumeIndex = args.indexOf('--resume');
        expect(resumeIndex).toBeGreaterThan(-1);
        expect(args[resumeIndex + 1]).toBe('stored-uuid-123');
        expect(args).not.toContain('-c');
        expect(args).not.toContain('--session-id');
    });

    it('creates new session via createSession when no existing mapping', async () => {
        mockedGetSession.mockReturnValue(undefined);
        mockedCreateSession.mockReturnValue('new-uuid-456');

        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', false, {}, undefined, 'thread_123');

        expect(mockedCreateSession).toHaveBeenCalledWith('thread_123', 'coder');
        const { args } = getSpawnArgs();
        const sessionIdIndex = args.indexOf('--session-id');
        expect(sessionIdIndex).toBeGreaterThan(-1);
        expect(args[sessionIdIndex + 1]).toBe('new-uuid-456');
        expect(args).not.toContain('--resume');
    });

    it('falls back to --session-id when --resume fails with session not found', async () => {
        mockedGetSession.mockReturnValue({ sessionId: 'old-uuid', agentId: 'coder', createdAt: Date.now() });
        mockedCreateSession.mockReturnValue('replacement-uuid');

        // First spawn (--resume) fails with "session not found", second spawn succeeds
        let callCount = 0;
        mockedSpawn.mockImplementation((() => {
            const EventEmitter = require('events');
            const { Readable } = require('stream');

            const stdout = new Readable({ read() {} });
            const stderr = new Readable({ read() {} });
            const child = new EventEmitter();
            child.stdout = stdout;
            child.stderr = stderr;
            child.stdout.setEncoding = vi.fn();
            child.stderr.setEncoding = vi.fn();

            callCount++;
            const isFirstCall = callCount === 1;

            setTimeout(() => {
                if (isFirstCall) {
                    stderr.push('Session not found');
                    stderr.push(null);
                    stdout.push(null);
                    child.emit('close', 1);
                } else {
                    stdout.push('fallback response');
                    stdout.push(null);
                    child.emit('close', 0);
                }
            }, 0);

            return child;
        }) as any);

        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        const result = await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', false, {}, undefined, 'thread_123');

        expect(result).toBe('fallback response');
        expect(mockedSpawn).toHaveBeenCalledTimes(2);
        expect(mockedCreateSession).toHaveBeenCalledWith('thread_123', 'coder');

        // First call used --resume
        const firstArgs = getSpawnArgs(0).args;
        expect(firstArgs).toContain('--resume');

        // Second call used --session-id with new UUID
        const secondArgs = getSpawnArgs(1).args;
        expect(secondArgs).toContain('--session-id');
        expect(secondArgs[secondArgs.indexOf('--session-id') + 1]).toBe('replacement-uuid');
    });

    it('propagates non-session-not-found errors instead of creating new session', async () => {
        mockedGetSession.mockReturnValue({ sessionId: 'old-uuid', agentId: 'coder', createdAt: Date.now() });

        // Spawn fails with a transient error (e.g. rate limit)
        mockedSpawn.mockImplementation((() => {
            const EventEmitter = require('events');
            const { Readable } = require('stream');

            const stdout = new Readable({ read() {} });
            const stderr = new Readable({ read() {} });
            const child = new EventEmitter();
            child.stdout = stdout;
            child.stderr = stderr;
            child.stdout.setEncoding = vi.fn();
            child.stderr.setEncoding = vi.fn();

            setTimeout(() => {
                stderr.push('Rate limit exceeded');
                stderr.push(null);
                stdout.push(null);
                child.emit('close', 1);
            }, 0);

            return child;
        }) as any);

        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await expect(
            invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', false, {}, undefined, 'thread_123')
        ).rejects.toThrow('Rate limit exceeded');

        // Should NOT have created a new session
        expect(mockedCreateSession).not.toHaveBeenCalled();
        // Should only have tried once (no fallback)
        expect(mockedSpawn).toHaveBeenCalledTimes(1);
    });

    it('uses --session-id with createSession when resetting with sessionKey', async () => {
        mockedCreateSession.mockReturnValue('reset-uuid');

        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true, {}, undefined, 'thread_123');

        expect(mockedCreateSession).toHaveBeenCalledWith('thread_123', 'coder');
        const { args } = getSpawnArgs();
        const sessionIdIndex = args.indexOf('--session-id');
        expect(sessionIdIndex).toBeGreaterThan(-1);
        expect(args[sessionIdIndex + 1]).toBe('reset-uuid');
        expect(args).not.toContain('--resume');
        expect(args).not.toContain('-c');
    });

    it('falls back to -c when no sessionKey and not resetting', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', false);

        const { args } = getSpawnArgs();
        expect(args).toContain('-c');
        expect(args).not.toContain('--resume');
        expect(args).not.toContain('--session-id');
    });

    it('has no session flags when resetting without sessionKey', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true);

        const { args } = getSpawnArgs();
        expect(args).not.toContain('-c');
        expect(args).not.toContain('--resume');
        expect(args).not.toContain('--session-id');
    });
});

describe('runCommand - timeout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects with timeout error when command exceeds timeout', async () => {
        const killFn = vi.fn();

        mockedSpawn.mockImplementation((() => {
            const EventEmitter = require('events');
            const { Readable } = require('stream');

            const stdout = new Readable({ read() {} });
            const stderr = new Readable({ read() {} });
            const child = new EventEmitter();
            child.stdout = stdout;
            child.stderr = stderr;
            child.stdout.setEncoding = vi.fn();
            child.stderr.setEncoding = vi.fn();
            child.killed = false;
            child.kill = killFn.mockImplementation(() => {
                child.killed = true;
                process.nextTick(() => {
                    stdout.push(null);
                    child.emit('close', null);
                });
            });

            // Never emit close — simulate a hanging process
            return child;
        }) as any);

        await expect(runCommand('claude', ['-p', 'test'], undefined, undefined, 100))
            .rejects.toThrow('Command timed out after 100ms');
    });

    it('resolves normally when command completes before timeout', async () => {
        mockedSpawn.mockImplementation(() => {
            const EventEmitter = require('events');
            const { Readable } = require('stream');

            const stdout = new Readable({ read() {} });
            const stderr = new Readable({ read() {} });
            const child = new EventEmitter();
            child.stdout = stdout;
            child.stderr = stderr;
            child.stdout.setEncoding = vi.fn();
            child.stderr.setEncoding = vi.fn();
            child.kill = vi.fn();
            child.killed = false;

            setTimeout(() => {
                stdout.push('fast response');
                stdout.push(null);
                child.emit('close', 0);
            }, 0);

            return child;
        });

        const result = await runCommand('claude', ['-p', 'test'], undefined, undefined, 5000);
        expect(result).toBe('fast response');
    });

    it('calls kill(SIGTERM) on the child process when timeout fires', async () => {
        const killFn = vi.fn();

        mockedSpawn.mockImplementation((() => {
            const EventEmitter = require('events');
            const { Readable } = require('stream');

            const stdout = new Readable({ read() {} });
            const stderr = new Readable({ read() {} });
            const child = new EventEmitter();
            child.stdout = stdout;
            child.stderr = stderr;
            child.stdout.setEncoding = vi.fn();
            child.stderr.setEncoding = vi.fn();
            child.killed = false;
            child.kill = killFn.mockImplementation(() => {
                child.killed = true;
                process.nextTick(() => {
                    stdout.push(null);
                    child.emit('close', null);
                });
            });

            return child;
        }) as any);

        await expect(runCommand('claude', ['-p', 'test'], undefined, undefined, 50))
            .rejects.toThrow('timed out');

        expect(killFn).toHaveBeenCalledWith('SIGTERM');
    });
});

describe('runCommandStreaming - NDJSON parsing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function mockStreamingSpawn(lines: string[], exitCode = 0) {
        mockedSpawn.mockImplementation((() => {
            const EventEmitter = require('events');
            const { Readable } = require('stream');

            const stdout = new Readable({ read() {} });
            const stderr = new Readable({ read() {} });
            const child = new EventEmitter();
            child.stdout = stdout;
            child.stderr = stderr;
            child.stdout.setEncoding = vi.fn();
            child.stderr.setEncoding = vi.fn();
            child.kill = vi.fn();
            child.killed = false;

            // Emit data first, then close on next tick so data handlers run first
            process.nextTick(() => {
                for (const line of lines) {
                    stdout.push(line + '\n');
                }
                stdout.push(null);
                // Delay close so data events are processed
                setTimeout(() => child.emit('close', exitCode), 0);
            });

            return child;
        }) as any);
    }

    it('parses content_block_delta events and calls onChunk with accumulated text', async () => {
        const lines = [
            JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }),
            JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }),
            JSON.stringify({ type: 'result', result: 'Hello world' }),
        ];
        mockStreamingSpawn(lines);

        const chunks: string[] = [];
        const result = await runCommandStreaming('claude', ['-p', 'test'], (acc) => chunks.push(acc));

        expect(result).toBe('Hello world');
        expect(chunks).toEqual(['Hello', 'Hello world']);
    });

    it('parses assistant events with content blocks', async () => {
        const lines = [
            JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi there' }] } }),
            JSON.stringify({ type: 'result', result: 'Hi there' }),
        ];
        mockStreamingSpawn(lines);

        const chunks: string[] = [];
        const result = await runCommandStreaming('claude', ['-p', 'test'], (acc) => chunks.push(acc));

        expect(result).toBe('Hi there');
        expect(chunks).toEqual(['Hi there']);
    });

    it('falls back to accumulated text when no result event', async () => {
        const lines = [
            JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }),
        ];
        mockStreamingSpawn(lines);

        const chunks: string[] = [];
        const result = await runCommandStreaming('claude', ['-p', 'test'], (acc) => chunks.push(acc));

        expect(result).toBe('partial');
    });

    it('handles mixed assistant and delta events', async () => {
        const lines = [
            JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Start' }] } }),
            JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' more' } }),
            JSON.stringify({ type: 'result', result: 'Start more' }),
        ];
        mockStreamingSpawn(lines);

        const chunks: string[] = [];
        const result = await runCommandStreaming('claude', ['-p', 'test'], (acc) => chunks.push(acc));

        expect(result).toBe('Start more');
        expect(chunks).toEqual(['Start', 'Start more']);
    });

    it('skips non-JSON lines gracefully', async () => {
        const lines = [
            'some debug output',
            JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }),
            JSON.stringify({ type: 'result', result: 'ok' }),
        ];
        mockStreamingSpawn(lines);

        const chunks: string[] = [];
        const result = await runCommandStreaming('claude', ['-p', 'test'], (acc) => chunks.push(acc));

        expect(result).toBe('ok');
    });

    it('rejects on non-zero exit code', async () => {
        mockedSpawn.mockImplementation((() => {
            const EventEmitter = require('events');
            const { Readable } = require('stream');

            const stdout = new Readable({ read() {} });
            const stderr = new Readable({ read() {} });
            const child = new EventEmitter();
            child.stdout = stdout;
            child.stderr = stderr;
            child.stdout.setEncoding = vi.fn();
            child.stderr.setEncoding = vi.fn();
            child.kill = vi.fn();
            child.killed = false;

            process.nextTick(() => {
                stderr.push('Some error');
                stderr.push(null);
                stdout.push(null);
                setTimeout(() => child.emit('close', 1), 0);
            });

            return child;
        }) as any);

        const chunks: string[] = [];
        await expect(
            runCommandStreaming('claude', ['-p', 'test'], (acc) => chunks.push(acc))
        ).rejects.toThrow('Some error');
    });

    it('handles timeout same as runCommand', async () => {
        const killFn = vi.fn();

        mockedSpawn.mockImplementation((() => {
            const EventEmitter = require('events');
            const { Readable } = require('stream');

            const stdout = new Readable({ read() {} });
            const stderr = new Readable({ read() {} });
            const child = new EventEmitter();
            child.stdout = stdout;
            child.stderr = stderr;
            child.stdout.setEncoding = vi.fn();
            child.stderr.setEncoding = vi.fn();
            child.killed = false;
            child.kill = killFn.mockImplementation(() => {
                child.killed = true;
                process.nextTick(() => {
                    stdout.push(null);
                    child.emit('close', null);
                });
            });

            return child;
        }) as any);

        await expect(
            runCommandStreaming('claude', ['-p', 'test'], () => {}, undefined, undefined, 100)
        ).rejects.toThrow('timed out');
    });
});

describe('invokeAgent - streaming support', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Restore default spawn mock
        mockedSpawn.mockImplementation((() => {
            const EventEmitter = require('events');
            const { Readable } = require('stream');

            const stdout = new Readable({ read() {} });
            const stderr = new Readable({ read() {} });
            const child = new EventEmitter();
            child.stdout = stdout;
            child.stderr = stderr;
            child.stdout.setEncoding = vi.fn();
            child.stderr.setEncoding = vi.fn();

            process.nextTick(() => {
                stdout.push('mocked response');
                stdout.push(null);
                child.emit('close', 0);
            });

            return child;
        }) as any);
    });

    function getSpawnArgs(): { command: string; args: string[] } {
        const call = mockedSpawn.mock.calls[0];
        return { command: call[0] as string, args: call[1] as string[] };
    }

    it('adds --output-format stream-json when onChunk is provided', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true, {}, undefined, undefined, () => {});

        const { args } = getSpawnArgs();
        const fmtIndex = args.indexOf('--output-format');
        expect(fmtIndex).toBeGreaterThan(-1);
        expect(args[fmtIndex + 1]).toBe('stream-json');
    });

    it('does not add --output-format when onChunk is not provided', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true);

        const { args } = getSpawnArgs();
        expect(args).not.toContain('--output-format');
    });

    it('does not add --output-format for codex provider even with onChunk', async () => {
        const agent: AgentConfig = {
            name: 'CodexAgent',
            provider: 'openai',
            model: 'gpt-5.3-codex',
            working_directory: '/tmp/codex',
        };

        await invokeAgent(agent, 'codex-agent', 'hello', '/tmp/workspace', true, {}, undefined, undefined, () => {});

        const { args } = getSpawnArgs();
        expect(args).not.toContain('--output-format');
    });
});
