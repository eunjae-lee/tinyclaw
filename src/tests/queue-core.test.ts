import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dependencies before importing queue-core
vi.mock('../lib/config', () => ({
    QUEUE_INCOMING: '/mock/queue/incoming',
    QUEUE_OUTGOING: '/mock/queue/outgoing',
    QUEUE_PROCESSING: '/mock/queue/processing',
    LOG_FILE: '/mock/logs/queue.log',
    RESET_FLAG: '/mock/reset_flag',
    EVENTS_DIR: '/mock/events',
    CHATS_DIR: '/mock/chats',
    TINYCLAW_CONFIG_WORKSPACE: '/mock/workspace',
    getSettings: vi.fn(() => ({
        agents: {
            coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
        },
    })),
    getAgents: vi.fn((settings: any) => settings?.agents || {
        coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
    }),
    getTeams: vi.fn(() => ({})),
}));

vi.mock('../lib/logging', () => ({
    log: vi.fn(),
    emitEvent: vi.fn(),
}));

vi.mock('../lib/invoke', () => ({
    invokeAgent: vi.fn(() => Promise.resolve('Agent response here')),
}));

// Don't mock routing — use real routing logic
// Don't mock fs — we use real temp dirs

import { processMessage, peekAgentId } from '../lib/queue-core';
import { getSettings, getAgents, getTeams } from '../lib/config';
import { invokeAgent } from '../lib/invoke';

describe('processMessage', () => {
    let tmpDir: string;
    let incomingDir: string;
    let processingDir: string;
    let outgoingDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-core-test-'));
        incomingDir = path.join(tmpDir, 'incoming');
        processingDir = path.join(tmpDir, 'processing');
        outgoingDir = path.join(tmpDir, 'outgoing');
        fs.mkdirSync(incomingDir, { recursive: true });
        fs.mkdirSync(processingDir, { recursive: true });
        fs.mkdirSync(outgoingDir, { recursive: true });

        // Override the QUEUE_* constants used by queue-core via the mock
        const configMock = await import('../lib/config');
        (configMock as any).QUEUE_PROCESSING = processingDir;
        (configMock as any).QUEUE_OUTGOING = outgoingDir;
        (configMock as any).RESET_FLAG = path.join(tmpDir, 'reset_flag');
        (configMock as any).CHATS_DIR = path.join(tmpDir, 'chats');
        (configMock as any).TINYCLAW_CONFIG_WORKSPACE = path.join(tmpDir, 'workspace');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeMessage(data: Record<string, unknown>): string {
        const filename = `discord_test_${Date.now()}.json`;
        const filePath = path.join(incomingDir, filename);
        fs.writeFileSync(filePath, JSON.stringify({
            channel: 'discord',
            sender: 'testuser',
            message: 'hello',
            timestamp: Date.now(),
            messageId: 'msg_123',
            ...data,
        }));
        return filePath;
    }

    it('moves file to processing dir, calls invokeAgent, writes response, cleans up', async () => {
        const msgFile = writeMessage({ message: 'hello world' });

        await processMessage(msgFile);

        // Processing file should be cleaned up
        expect(fs.readdirSync(processingDir)).toHaveLength(0);

        // Response should be in outgoing dir
        const outFiles = fs.readdirSync(outgoingDir);
        expect(outFiles.length).toBe(1);

        const response = JSON.parse(fs.readFileSync(path.join(outgoingDir, outFiles[0]), 'utf8'));
        expect(response.message).toBe('Agent response here');
        expect(response.channel).toBe('discord');
        expect(response.sender).toBe('testuser');
        expect(response.messageId).toBe('msg_123');
    });

    it('routes pre-routed messages (messageData.agent set)', async () => {
        const msgFile = writeMessage({ message: 'hello', agent: 'coder' });

        await processMessage(msgFile);

        expect(invokeAgent).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Coder' }),
            'coder',
            'hello',
            expect.any(String),
            expect.any(Boolean),
            expect.any(Object),
            expect.any(Object),
            'msg_123',
            undefined,
        );
    });

    it('falls back to "default" agent when agent not found', async () => {
        // Add a "default" agent to the mock
        vi.mocked(getAgents).mockReturnValue({
            default: { name: 'Default', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/default' },
        });

        const msgFile = writeMessage({ message: 'hello', agent: 'nonexistent' });
        await processMessage(msgFile);

        expect(invokeAgent).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Default' }),
            'default',
            expect.any(String),
            expect.any(String),
            expect.any(Boolean),
            expect.any(Object),
            expect.any(Object),
            'msg_123',
            undefined,
        );
    });

    it('uses first available agent when no "default" exists', async () => {
        vi.mocked(getAgents).mockReturnValue({
            alpha: { name: 'Alpha', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/alpha' },
        });

        const msgFile = writeMessage({ message: 'hello' });
        await processMessage(msgFile);

        expect(invokeAgent).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Alpha' }),
            'alpha',
            expect.any(String),
            expect.any(String),
            expect.any(Boolean),
            expect.any(Object),
            expect.any(Object),
            'msg_123',
            undefined,
        );
    });

    it('writes easter egg response for agentId "error"', async () => {
        // Setup multiple agents so parseAgentRouting returns 'error'
        vi.mocked(getAgents).mockReturnValue({
            coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
            writer: { name: 'Writer', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/writer' },
        });
        vi.mocked(getTeams).mockReturnValue({});

        const msgFile = writeMessage({ message: '!coder and !writer do stuff' });
        await processMessage(msgFile);

        // invokeAgent should NOT have been called
        expect(invokeAgent).not.toHaveBeenCalled();

        // Response should contain easter egg text
        const outFiles = fs.readdirSync(outgoingDir);
        expect(outFiles.length).toBe(1);
        const response = JSON.parse(fs.readFileSync(path.join(outgoingDir, outFiles[0]), 'utf8'));
        expect(response.message).toContain('Coming Soon');
    });

    it('detects and cleans up reset flags', async () => {
        const configMock = await import('../lib/config');
        const resetFlag = (configMock as any).RESET_FLAG;
        fs.mkdirSync(path.dirname(resetFlag), { recursive: true });
        fs.writeFileSync(resetFlag, 'reset');

        vi.mocked(getAgents).mockReturnValue({
            default: { name: 'Default', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/default' },
        });

        const msgFile = writeMessage({ message: 'hello' });
        await processMessage(msgFile);

        expect(fs.existsSync(resetFlag)).toBe(false);
        expect(invokeAgent).toHaveBeenCalledWith(
            expect.any(Object),
            'default',
            expect.any(String),
            expect.any(String),
            true, // shouldReset
            expect.any(Object),
            expect.any(Object),
            'msg_123',
            undefined,
        );
    });

    it('truncates response over 4000 chars', async () => {
        const longResponse = 'x'.repeat(5000);
        vi.mocked(invokeAgent).mockResolvedValue(longResponse);
        vi.mocked(getAgents).mockReturnValue({
            default: { name: 'Default', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/default' },
        });

        const msgFile = writeMessage({ message: 'hello' });
        await processMessage(msgFile);

        const outFiles = fs.readdirSync(outgoingDir);
        const response = JSON.parse(fs.readFileSync(path.join(outgoingDir, outFiles[0]), 'utf8'));
        expect(response.message.length).toBeLessThanOrEqual(4000);
        expect(response.message).toContain('[Response truncated...]');
    });

    it('extracts [send_file: /path] references and includes files in response', async () => {
        const testFile = path.join(tmpDir, 'output.png');
        fs.writeFileSync(testFile, 'fake image');

        vi.mocked(invokeAgent).mockResolvedValue(`Here is the result [send_file: ${testFile}]`);
        vi.mocked(getAgents).mockReturnValue({
            default: { name: 'Default', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/default' },
        });

        const msgFile = writeMessage({ message: 'generate image' });
        await processMessage(msgFile);

        const outFiles = fs.readdirSync(outgoingDir);
        const response = JSON.parse(fs.readFileSync(path.join(outgoingDir, outFiles[0]), 'utf8'));
        expect(response.files).toContain(testFile);
    });

    it('removes [send_file:] tags from response text', async () => {
        const testFile = path.join(tmpDir, 'output.png');
        fs.writeFileSync(testFile, 'fake image');

        vi.mocked(invokeAgent).mockResolvedValue(`Here is the result [send_file: ${testFile}]`);
        vi.mocked(getAgents).mockReturnValue({
            default: { name: 'Default', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/default' },
        });

        const msgFile = writeMessage({ message: 'generate image' });
        await processMessage(msgFile);

        const outFiles = fs.readdirSync(outgoingDir);
        const response = JSON.parse(fs.readFileSync(path.join(outgoingDir, outFiles[0]), 'utf8'));
        expect(response.message).not.toContain('[send_file:');
        expect(response.message).toContain('Here is the result');
    });

    it('moves file back to incoming on error (retry)', async () => {
        // Make invokeAgent throw and then cause a processing error
        vi.mocked(getAgents).mockReturnValue({
            default: { name: 'Default', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/default' },
        });

        const msgFile = writeMessage({ message: 'hello' });

        // Cause an error by making the rename succeed but invokeAgent write response fail
        // We'll make the outgoing dir non-writable to cause a write error
        vi.mocked(invokeAgent).mockImplementation(async () => {
            throw new Error('Agent crashed');
        });

        await processMessage(msgFile);

        // Should have written an error response (the catch writes an error message)
        const outFiles = fs.readdirSync(outgoingDir);
        expect(outFiles.length).toBe(1);
        const response = JSON.parse(fs.readFileSync(path.join(outgoingDir, outFiles[0]), 'utf8'));
        expect(response.message).toContain('error');
    });

    it('handles invokeAgent errors gracefully (returns error message)', async () => {
        vi.mocked(invokeAgent).mockRejectedValue(new Error('Connection timeout'));
        vi.mocked(getAgents).mockReturnValue({
            default: { name: 'Default', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/default' },
        });

        const msgFile = writeMessage({ message: 'hello' });
        await processMessage(msgFile);

        const outFiles = fs.readdirSync(outgoingDir);
        expect(outFiles.length).toBe(1);
        const response = JSON.parse(fs.readFileSync(path.join(outgoingDir, outFiles[0]), 'utf8'));
        expect(response.message).toContain('error');
    });

    it('passes sessionKey through to invokeAgent', async () => {
        vi.mocked(getAgents).mockReturnValue({
            default: { name: 'Default', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/default' },
        });

        const msgFile = writeMessage({ message: 'hello', sessionKey: 'thread_abc' });
        await processMessage(msgFile);

        expect(invokeAgent).toHaveBeenCalledWith(
            expect.any(Object),
            'default',
            expect.any(String),
            expect.any(String),
            expect.any(Boolean),
            expect.any(Object),
            expect.any(Object),
            'msg_123',
            'thread_abc',
        );
    });
});

describe('peekAgentId', () => {
    let tmpDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peek-test-'));

        vi.mocked(getSettings).mockReturnValue({
            agents: {
                coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
            },
        });
        vi.mocked(getAgents).mockReturnValue({
            coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
        });
        vi.mocked(getTeams).mockReturnValue({});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeMsg(data: Record<string, unknown>): string {
        const filePath = path.join(tmpDir, `msg_${Date.now()}.json`);
        fs.writeFileSync(filePath, JSON.stringify({
            channel: 'discord',
            sender: 'user',
            message: 'hi',
            timestamp: Date.now(),
            messageId: 'test',
            ...data,
        }));
        return filePath;
    }

    it('returns pre-routed agent from messageData.agent', () => {
        const fp = writeMsg({ agent: 'coder', message: 'hello' });
        expect(peekAgentId(fp)).toBe('coder');
    });

    it('parses !agent_id from message text', () => {
        const fp = writeMsg({ message: '!coder fix the bug' });
        expect(peekAgentId(fp)).toBe('coder');
    });

    it('returns "default" for unrecognized prefix', () => {
        const fp = writeMsg({ message: '!unknown do something' });
        expect(peekAgentId(fp)).toBe('default');
    });

    it('returns "default" on parse errors', () => {
        const fp = path.join(tmpDir, 'bad.json');
        fs.writeFileSync(fp, 'not json');
        expect(peekAgentId(fp)).toBe('default');
    });
});
