import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use a real temp directory for all file operations
const TEST_ROOT = path.join(os.tmpdir(), `tinyclaw-approval-test-${process.pid}`);
const FAKE_SCRIPT_DIR = path.join(TEST_ROOT, 'script');
const FAKE_APPROVALS_DIR = path.join(TEST_ROOT, 'approvals');

vi.mock('../lib/config', () => ({
    SCRIPT_DIR: path.join(os.tmpdir(), `tinyclaw-approval-test-${process.pid}`, 'script'),
    APPROVALS_DIR: path.join(os.tmpdir(), `tinyclaw-approval-test-${process.pid}`, 'approvals'),
    APPROVALS_PENDING: path.join(os.tmpdir(), `tinyclaw-approval-test-${process.pid}`, 'approvals', 'pending'),
    APPROVALS_DECISIONS: path.join(os.tmpdir(), `tinyclaw-approval-test-${process.pid}`, 'approvals', 'decisions'),
}));

import { configureApprovalHook } from '../lib/agent-setup';

describe('configureApprovalHook', () => {
    const testAgentDir = path.join(TEST_ROOT, 'agent');
    const claudeLocalPath = path.join(testAgentDir, '.claude', 'settings.local.json');

    beforeEach(() => {
        // Create all directories fresh
        fs.mkdirSync(path.join(testAgentDir, '.claude'), { recursive: true });
        fs.mkdirSync(path.join(FAKE_SCRIPT_DIR, 'dist', 'lib'), { recursive: true });
        fs.writeFileSync(
            path.join(FAKE_SCRIPT_DIR, 'dist', 'lib', 'approval-hook.js'),
            '// compiled hook'
        );
    });

    afterEach(() => {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    });

    it('writes hooks config to agent .claude/settings.local.json', () => {
        configureApprovalHook(testAgentDir);

        expect(fs.existsSync(claudeLocalPath)).toBe(true);
        const settings = JSON.parse(fs.readFileSync(claudeLocalPath, 'utf8'));

        expect(settings.hooks).toBeDefined();
        expect(settings.hooks.PreToolUse).toHaveLength(1);
        expect(settings.hooks.PreToolUse[0].matcher).toBe('.*');
        expect(settings.hooks.PreToolUse[0].hooks).toHaveLength(1);
        expect(settings.hooks.PreToolUse[0].hooks[0].type).toBe('command');
        expect(settings.hooks.PreToolUse[0].hooks[0].timeout).toBe(600);
    });

    it('uses node with absolute path to approval-hook.js', () => {
        configureApprovalHook(testAgentDir);

        const settings = JSON.parse(fs.readFileSync(claudeLocalPath, 'utf8'));
        const command: string = settings.hooks.PreToolUse[0].hooks[0].command;

        expect(command).toMatch(/^node /);
        expect(command).toContain('approval-hook.js');
    });

    it('merges with existing settings without overwriting', () => {
        fs.writeFileSync(claudeLocalPath, JSON.stringify({
            existingKey: 'existingValue',
            anotherSetting: true,
        }, null, 2));

        configureApprovalHook(testAgentDir);

        const settings = JSON.parse(fs.readFileSync(claudeLocalPath, 'utf8'));
        expect(settings.existingKey).toBe('existingValue');
        expect(settings.anotherSetting).toBe(true);
        expect(settings.hooks).toBeDefined();
    });

    it('creates approvals directories', () => {
        configureApprovalHook(testAgentDir);

        expect(fs.existsSync(FAKE_APPROVALS_DIR)).toBe(true);
        expect(fs.existsSync(path.join(FAKE_APPROVALS_DIR, 'pending'))).toBe(true);
        expect(fs.existsSync(path.join(FAKE_APPROVALS_DIR, 'decisions'))).toBe(true);
    });

    it('does nothing when approval-hook.js does not exist', () => {
        // Remove the fake hook script
        fs.unlinkSync(path.join(FAKE_SCRIPT_DIR, 'dist', 'lib', 'approval-hook.js'));

        // Write existing settings that should not be modified
        fs.writeFileSync(claudeLocalPath, JSON.stringify({ keep: true }, null, 2));

        configureApprovalHook(testAgentDir);

        const settings = JSON.parse(fs.readFileSync(claudeLocalPath, 'utf8'));
        expect(settings.hooks).toBeUndefined();
        expect(settings.keep).toBe(true);
    });
});
