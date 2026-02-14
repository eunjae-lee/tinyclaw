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
    updateAgentTeammates: vi.fn(),
}));

vi.mock('../lib/logging', () => ({
    log: vi.fn(),
}));

import fs from 'fs';
import { spawn } from 'child_process';
import { invokeAgent, deterministicUUID } from '../lib/invoke';

const mockedSpawn = vi.mocked(spawn);

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
    });

    function getSpawnArgs(): { command: string; args: string[] } {
        const call = mockedSpawn.mock.calls[0];
        return { command: call[0] as string, args: call[1] as string[] };
    }

    it('uses --session-id when sessionKey provided and session does not exist yet', async () => {
        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', false, {}, {}, undefined, 'thread_123');

        const { args } = getSpawnArgs();
        const sessionIdIndex = args.indexOf('--session-id');
        expect(sessionIdIndex).toBeGreaterThan(-1);
        const expectedUUID = deterministicUUID('coder:thread_123');
        expect(args[sessionIdIndex + 1]).toBe(expectedUUID);
        expect(args).not.toContain('-c');
        expect(args).not.toContain('--resume');
    });

    it('uses --resume when sessionKey provided and session already exists', async () => {
        const realExistsSync = fs.existsSync.bind(fs);
        const spy = vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
            if (String(p).endsWith('.jsonl')) return true;
            return realExistsSync(p);
        });

        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', false, {}, {}, undefined, 'thread_123');
        spy.mockRestore();

        const { args } = getSpawnArgs();
        const resumeIndex = args.indexOf('--resume');
        expect(resumeIndex).toBeGreaterThan(-1);
        const expectedUUID = deterministicUUID('coder:thread_123');
        expect(args[resumeIndex + 1]).toBe(expectedUUID);
        expect(args).not.toContain('-c');
        expect(args).not.toContain('--session-id');
    });

    it('uses --session-id when resetting even if session exists', async () => {
        const realExistsSync = fs.existsSync.bind(fs);
        const spy = vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
            if (String(p).endsWith('.jsonl')) return true;
            return realExistsSync(p);
        });

        const agent: AgentConfig = {
            name: 'Coder',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: '/tmp/coder',
        };

        await invokeAgent(agent, 'coder', 'hello', '/tmp/workspace', true, {}, {}, undefined, 'thread_123');
        spy.mockRestore();

        const { args } = getSpawnArgs();
        const sessionIdIndex = args.indexOf('--session-id');
        expect(sessionIdIndex).toBeGreaterThan(-1);
        expect(args).not.toContain('--resume');
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

    it('generates different UUIDs for different agents in the same thread', () => {
        const uuid1 = deterministicUUID('agent1:thread_123');
        const uuid2 = deterministicUUID('agent2:thread_123');
        expect(uuid1).not.toBe(uuid2);
    });

    it('generates same UUID for same agent and session key', () => {
        const uuid1 = deterministicUUID('coder:thread_123');
        const uuid2 = deterministicUUID('coder:thread_123');
        expect(uuid1).toBe(uuid2);
    });

    it('generates valid UUID format', () => {
        const uuid = deterministicUUID('test:key');
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});
