import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { copyDirSync, ensureAgentDirectory, configureApprovalHook, updateAgentTeammates } from '../lib/agent-setup';
import type { AgentConfig, TeamConfig } from '../lib/types';

// We need to mock SCRIPT_DIR and APPROVALS_* so ensureAgentDirectory looks in our temp dir
vi.mock('../lib/config', async () => {
    const actual = await vi.importActual('../lib/config');
    return {
        ...actual,
        // These will be overridden per-test in beforeEach
        SCRIPT_DIR: '/mock/script/dir',
        APPROVALS_DIR: '/mock/approvals',
        APPROVALS_PENDING: '/mock/approvals/pending',
        APPROVALS_DECISIONS: '/mock/approvals/decisions',
    };
});

describe('copyDirSync', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copydirtest-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('copies flat directory', () => {
        const src = path.join(tmpDir, 'src');
        const dest = path.join(tmpDir, 'dest');
        fs.mkdirSync(src);
        fs.writeFileSync(path.join(src, 'a.txt'), 'hello');
        fs.writeFileSync(path.join(src, 'b.txt'), 'world');

        copyDirSync(src, dest);

        expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('hello');
        expect(fs.readFileSync(path.join(dest, 'b.txt'), 'utf8')).toBe('world');
    });

    it('copies nested directories recursively', () => {
        const src = path.join(tmpDir, 'src');
        fs.mkdirSync(path.join(src, 'sub', 'deep'), { recursive: true });
        fs.writeFileSync(path.join(src, 'root.txt'), 'root');
        fs.writeFileSync(path.join(src, 'sub', 'mid.txt'), 'mid');
        fs.writeFileSync(path.join(src, 'sub', 'deep', 'leaf.txt'), 'leaf');

        const dest = path.join(tmpDir, 'dest');
        copyDirSync(src, dest);

        expect(fs.readFileSync(path.join(dest, 'root.txt'), 'utf8')).toBe('root');
        expect(fs.readFileSync(path.join(dest, 'sub', 'mid.txt'), 'utf8')).toBe('mid');
        expect(fs.readFileSync(path.join(dest, 'sub', 'deep', 'leaf.txt'), 'utf8')).toBe('leaf');
    });
});

describe('ensureAgentDirectory', () => {
    let tmpDir: string;
    let scriptDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensureagent-'));
        scriptDir = path.join(tmpDir, 'scriptdir');
        fs.mkdirSync(scriptDir, { recursive: true });

        // Override SCRIPT_DIR in the mock
        const configMock = await import('../lib/config');
        (configMock as any).SCRIPT_DIR = scriptDir;
        (configMock as any).APPROVALS_DIR = path.join(tmpDir, 'approvals');
        (configMock as any).APPROVALS_PENDING = path.join(tmpDir, 'approvals', 'pending');
        (configMock as any).APPROVALS_DECISIONS = path.join(tmpDir, 'approvals', 'decisions');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates directory with expected structure', () => {
        const agentDir = path.join(tmpDir, 'agent1');
        ensureAgentDirectory(agentDir);

        expect(fs.existsSync(agentDir)).toBe(true);
        expect(fs.existsSync(path.join(agentDir, '.tinyclaw'))).toBe(true);
    });

    it('skips if directory already exists', () => {
        const agentDir = path.join(tmpDir, 'existing');
        fs.mkdirSync(agentDir);
        fs.writeFileSync(path.join(agentDir, 'marker.txt'), 'original');

        ensureAgentDirectory(agentDir);

        // Should not have overwritten anything
        expect(fs.readFileSync(path.join(agentDir, 'marker.txt'), 'utf8')).toBe('original');
    });

    it('copies .claude/ directory from source', () => {
        const sourceClaudeDir = path.join(scriptDir, '.claude');
        fs.mkdirSync(sourceClaudeDir);
        fs.writeFileSync(path.join(sourceClaudeDir, 'settings.json'), '{}');

        const agentDir = path.join(tmpDir, 'agent2');
        ensureAgentDirectory(agentDir);

        expect(fs.existsSync(path.join(agentDir, '.claude', 'settings.json'))).toBe(true);
    });

    it('copies heartbeat.md and AGENTS.md', () => {
        fs.mkdirSync(path.join(scriptDir, 'templates'), { recursive: true });
        fs.writeFileSync(path.join(scriptDir, 'templates', 'heartbeat.md'), '# Heartbeat');
        fs.writeFileSync(path.join(scriptDir, 'templates', 'AGENTS.md'), '# Agents');

        const agentDir = path.join(tmpDir, 'agent3');
        ensureAgentDirectory(agentDir);

        expect(fs.readFileSync(path.join(agentDir, 'heartbeat.md'), 'utf8')).toBe('# Heartbeat');
        expect(fs.readFileSync(path.join(agentDir, 'AGENTS.md'), 'utf8')).toBe('# Agents');
    });

    it('creates .tinyclaw/ with SOUL.md', () => {
        fs.writeFileSync(path.join(scriptDir, 'SOUL.md'), '# Soul');

        const agentDir = path.join(tmpDir, 'agent4');
        ensureAgentDirectory(agentDir);

        expect(fs.readFileSync(path.join(agentDir, '.tinyclaw', 'SOUL.md'), 'utf8')).toBe('# Soul');
    });
});

describe('configureApprovalHook', () => {
    let tmpDir: string;
    let scriptDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approvaltest-'));
        scriptDir = path.join(tmpDir, 'scriptdir');
        fs.mkdirSync(scriptDir, { recursive: true });

        const configMock = await import('../lib/config');
        (configMock as any).SCRIPT_DIR = scriptDir;
        (configMock as any).APPROVALS_DIR = path.join(tmpDir, 'approvals');
        (configMock as any).APPROVALS_PENDING = path.join(tmpDir, 'approvals', 'pending');
        (configMock as any).APPROVALS_DECISIONS = path.join(tmpDir, 'approvals', 'decisions');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes settings.local.json with PreToolUse hook', () => {
        // Create the hook script so configureApprovalHook doesn't skip
        const hookScript = path.join(scriptDir, 'dist', 'lib', 'approval-hook.js');
        fs.mkdirSync(path.dirname(hookScript), { recursive: true });
        fs.writeFileSync(hookScript, '// hook');

        const agentDir = path.join(tmpDir, 'agent');
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });

        configureApprovalHook(agentDir);

        const settingsPath = path.join(agentDir, '.claude', 'settings.local.json');
        expect(fs.existsSync(settingsPath)).toBe(true);

        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        expect(settings.hooks).toBeDefined();
        expect(settings.hooks.PreToolUse).toBeDefined();
        expect(settings.hooks.PreToolUse[0].matcher).toBe('.*');
    });

    it('preserves existing settings fields', () => {
        const hookScript = path.join(scriptDir, 'dist', 'lib', 'approval-hook.js');
        fs.mkdirSync(path.dirname(hookScript), { recursive: true });
        fs.writeFileSync(hookScript, '// hook');

        const agentDir = path.join(tmpDir, 'agent');
        const claudeDir = path.join(agentDir, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        fs.writeFileSync(path.join(claudeDir, 'settings.local.json'), JSON.stringify({ customField: 'keep' }));

        configureApprovalHook(agentDir);

        const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.local.json'), 'utf8'));
        expect(settings.customField).toBe('keep');
        expect(settings.hooks).toBeDefined();
    });

    it('skips when hook script does not exist', () => {
        const agentDir = path.join(tmpDir, 'agent');
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });

        configureApprovalHook(agentDir);

        expect(fs.existsSync(path.join(agentDir, '.claude', 'settings.local.json'))).toBe(false);
    });
});

describe('updateAgentTeammates', () => {
    let tmpDir: string;

    const agents: Record<string, AgentConfig> = {
        coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
        reviewer: { name: 'Reviewer', provider: 'anthropic', model: 'opus', working_directory: '/tmp/reviewer' },
        writer: { name: 'Writer', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/writer' },
    };

    const teams: Record<string, TeamConfig> = {
        devteam: { name: 'DevTeam', agents: ['coder', 'reviewer'], leader_agent: 'coder' },
    };

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('injects teammate info between markers in AGENTS.md', () => {
        const agentDir = path.join(tmpDir, 'coder');
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(path.join(agentDir, 'AGENTS.md'),
            '# Agents\n<!-- TEAMMATES_START --><!-- TEAMMATES_END -->\n# End');

        updateAgentTeammates(agentDir, 'coder', agents, teams);

        const content = fs.readFileSync(path.join(agentDir, 'AGENTS.md'), 'utf8');
        expect(content).toContain('@coder');
        expect(content).toContain('@reviewer');
        expect(content).toContain('# End');
    });

    it('writes teammate info to .claude/CLAUDE.md', () => {
        const agentDir = path.join(tmpDir, 'coder');
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(agentDir, 'AGENTS.md'),
            '<!-- TEAMMATES_START --><!-- TEAMMATES_END -->');

        updateAgentTeammates(agentDir, 'coder', agents, teams);

        const claudeMd = fs.readFileSync(path.join(agentDir, '.claude', 'CLAUDE.md'), 'utf8');
        expect(claudeMd).toContain('TEAMMATES_START');
        expect(claudeMd).toContain('@reviewer');
    });

    it('handles agent not in any team (no teammates section)', () => {
        const agentDir = path.join(tmpDir, 'writer');
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(path.join(agentDir, 'AGENTS.md'),
            '<!-- TEAMMATES_START --><!-- TEAMMATES_END -->');

        updateAgentTeammates(agentDir, 'writer', agents, teams);

        const content = fs.readFileSync(path.join(agentDir, 'AGENTS.md'), 'utf8');
        // Writer is not in devteam, so no teammates
        expect(content).toContain('@writer');
        expect(content).not.toContain('@coder');
        expect(content).not.toContain('Your Teammates');
    });
});
