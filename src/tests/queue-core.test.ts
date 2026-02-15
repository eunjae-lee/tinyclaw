import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dependencies before importing queue-core
vi.mock('../lib/config', () => ({
    QUEUE_INCOMING: '/mock/queue/incoming',
    QUEUE_OUTGOING: '/mock/queue/outgoing',
    QUEUE_PROCESSING: '/mock/queue/processing',
    QUEUE_DEAD_LETTER: '/mock/queue/dead-letter',
    QUEUE_CANCEL: '/mock/queue/cancel',
    MAX_RETRY_COUNT: 3,
    LOG_FILE: '/mock/logs/queue.log',
    RESET_FLAG: '/mock/reset_flag',
    EVENTS_DIR: '/mock/events',
    TINYCLAW_CONFIG_WORKSPACE: '/mock/workspace',
    getSettings: vi.fn(() => ({
        agents: {
            coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
        },
    })),
    getAgents: vi.fn((settings: any) => settings?.agents || {
        coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
    }),
}));

vi.mock('../lib/logging', () => ({
    log: vi.fn(),
    emitEvent: vi.fn(),
}));

vi.mock('../lib/invoke', () => ({
    invokeAgent: vi.fn((...args: any[]) => Promise.resolve('Agent response here')),
}));

// Don't mock routing — use real routing logic
// Don't mock fs — we use real temp dirs

import { processMessage, peekAgentId, recoverStuckFiles } from '../lib/queue-core';
import { getSettings, getAgents } from '../lib/config';
import { invokeAgent } from '../lib/invoke';

describe('processMessage', () => {
    let tmpDir: string;
    let incomingDir: string;
    let processingDir: string;
    let outgoingDir: string;
    let deadLetterDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-core-test-'));
        incomingDir = path.join(tmpDir, 'incoming');
        processingDir = path.join(tmpDir, 'processing');
        outgoingDir = path.join(tmpDir, 'outgoing');
        deadLetterDir = path.join(tmpDir, 'dead-letter');
        fs.mkdirSync(incomingDir, { recursive: true });
        fs.mkdirSync(processingDir, { recursive: true });
        fs.mkdirSync(outgoingDir, { recursive: true });
        fs.mkdirSync(deadLetterDir, { recursive: true });

        // Override the QUEUE_* constants used by queue-core via the mock
        const configMock = await import('../lib/config');
        (configMock as any).QUEUE_INCOMING = incomingDir;
        (configMock as any).QUEUE_PROCESSING = processingDir;
        (configMock as any).QUEUE_OUTGOING = outgoingDir;
        (configMock as any).QUEUE_DEAD_LETTER = deadLetterDir;
        (configMock as any).QUEUE_CANCEL = path.join(tmpDir, 'cancel');
        (configMock as any).MAX_RETRY_COUNT = 3;
        (configMock as any).RESET_FLAG = path.join(tmpDir, 'reset_flag');
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
            'msg_123',
            undefined,
            expect.any(Function),
            expect.any(AbortSignal),
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
            'msg_123',
            undefined,
            expect.any(Function),
            expect.any(AbortSignal),
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
            'msg_123',
            undefined,
            expect.any(Function),
            expect.any(AbortSignal),
        );
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
            'msg_123',
            undefined,
            expect.any(Function),
            expect.any(AbortSignal),
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
            'msg_123',
            'thread_abc',
            expect.any(Function),
            expect.any(AbortSignal),
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

describe('processMessage - retry and dead-letter', () => {
    let tmpDir: string;
    let incomingDir: string;
    let processingDir: string;
    let outgoingDir: string;
    let deadLetterDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-test-'));
        incomingDir = path.join(tmpDir, 'incoming');
        processingDir = path.join(tmpDir, 'processing');
        outgoingDir = path.join(tmpDir, 'outgoing');
        deadLetterDir = path.join(tmpDir, 'dead-letter');
        fs.mkdirSync(incomingDir, { recursive: true });
        fs.mkdirSync(processingDir, { recursive: true });
        fs.mkdirSync(outgoingDir, { recursive: true });
        fs.mkdirSync(deadLetterDir, { recursive: true });

        const configMock = await import('../lib/config');
        (configMock as any).QUEUE_INCOMING = incomingDir;
        (configMock as any).QUEUE_PROCESSING = processingDir;
        (configMock as any).QUEUE_OUTGOING = outgoingDir;
        (configMock as any).QUEUE_DEAD_LETTER = deadLetterDir;
        (configMock as any).QUEUE_CANCEL = path.join(tmpDir, 'cancel');
        (configMock as any).MAX_RETRY_COUNT = 3;
        (configMock as any).RESET_FLAG = path.join(tmpDir, 'reset_flag');
        (configMock as any).TINYCLAW_CONFIG_WORKSPACE = path.join(tmpDir, 'workspace');

        // Make getSettings throw to trigger the outer catch block in processMessage
        vi.mocked(getSettings).mockImplementation(() => { throw new Error('Settings corrupt'); });
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
            messageId: 'msg_retry',
            ...data,
        }));
        return filePath;
    }

    it('increments retryCount on processing error and moves back to incoming', async () => {
        const msgFile = writeMessage({ message: 'hello' });
        await processMessage(msgFile);

        const incomingFiles = fs.readdirSync(incomingDir);
        expect(incomingFiles).toHaveLength(1);
        const data = JSON.parse(fs.readFileSync(path.join(incomingDir, incomingFiles[0]), 'utf8'));
        expect(data.retryCount).toBe(1);
    });

    it('treats missing retryCount as 0 (first retry becomes 1)', async () => {
        const msgFile = writeMessage({ message: 'hello' }); // no retryCount field
        await processMessage(msgFile);

        const incomingFiles = fs.readdirSync(incomingDir);
        expect(incomingFiles).toHaveLength(1);
        const data = JSON.parse(fs.readFileSync(path.join(incomingDir, incomingFiles[0]), 'utf8'));
        expect(data.retryCount).toBe(1);
    });

    it('moves message to dead-letter after max retries', async () => {
        // Message already at retryCount=2, one more failure = 3 = MAX_RETRY_COUNT
        const msgFile = writeMessage({ message: 'hello', retryCount: 2 });
        await processMessage(msgFile);

        // Should NOT be in incoming
        expect(fs.readdirSync(incomingDir)).toHaveLength(0);
        // Should NOT be in processing
        expect(fs.readdirSync(processingDir)).toHaveLength(0);
        // Should be in dead-letter
        const dlFiles = fs.readdirSync(deadLetterDir);
        expect(dlFiles).toHaveLength(1);
        const data = JSON.parse(fs.readFileSync(path.join(deadLetterDir, dlFiles[0]), 'utf8'));
        expect(data.retryCount).toBe(3);
    });
});

describe('recoverStuckFiles', () => {
    let tmpDir: string;
    let incomingDir: string;
    let processingDir: string;
    let deadLetterDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-test-'));
        incomingDir = path.join(tmpDir, 'incoming');
        processingDir = path.join(tmpDir, 'processing');
        deadLetterDir = path.join(tmpDir, 'dead-letter');
        fs.mkdirSync(incomingDir, { recursive: true });
        fs.mkdirSync(processingDir, { recursive: true });
        fs.mkdirSync(deadLetterDir, { recursive: true });

        const configMock = await import('../lib/config');
        (configMock as any).QUEUE_INCOMING = incomingDir;
        (configMock as any).QUEUE_PROCESSING = processingDir;
        (configMock as any).QUEUE_DEAD_LETTER = deadLetterDir;
        (configMock as any).MAX_RETRY_COUNT = 3;
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeStuckFile(data: Record<string, unknown>, ageMs: number): string {
        const filename = `discord_test_${Date.now()}.json`;
        const filePath = path.join(processingDir, filename);
        fs.writeFileSync(filePath, JSON.stringify({
            channel: 'discord',
            sender: 'testuser',
            message: 'hello',
            timestamp: Date.now(),
            messageId: 'msg_stuck',
            ...data,
        }));
        // Backdate the file modification time
        const pastTime = new Date(Date.now() - ageMs);
        fs.utimesSync(filePath, pastTime, pastTime);
        return filePath;
    }

    it('recovers files older than threshold back to incoming', () => {
        writeStuckFile({ message: 'stuck message' }, 20 * 60 * 1000); // 20 min old

        const recovered = recoverStuckFiles(15 * 60 * 1000); // 15 min threshold

        expect(recovered).toBe(1);
        expect(fs.readdirSync(processingDir)).toHaveLength(0);
        const incomingFiles = fs.readdirSync(incomingDir);
        expect(incomingFiles).toHaveLength(1);
        const data = JSON.parse(fs.readFileSync(path.join(incomingDir, incomingFiles[0]), 'utf8'));
        expect(data.retryCount).toBe(1);
    });

    it('does not touch files newer than threshold', () => {
        writeStuckFile({ message: 'recent message' }, 5 * 60 * 1000); // 5 min old

        const recovered = recoverStuckFiles(15 * 60 * 1000);

        expect(recovered).toBe(0);
        expect(fs.readdirSync(processingDir)).toHaveLength(1);
        expect(fs.readdirSync(incomingDir)).toHaveLength(0);
    });

    it('moves to dead-letter when retryCount reaches max', () => {
        writeStuckFile({ message: 'doomed', retryCount: 2 }, 20 * 60 * 1000);

        const recovered = recoverStuckFiles(15 * 60 * 1000);

        expect(recovered).toBe(1);
        expect(fs.readdirSync(processingDir)).toHaveLength(0);
        expect(fs.readdirSync(incomingDir)).toHaveLength(0);
        const dlFiles = fs.readdirSync(deadLetterDir);
        expect(dlFiles).toHaveLength(1);
        const data = JSON.parse(fs.readFileSync(path.join(deadLetterDir, dlFiles[0]), 'utf8'));
        expect(data.retryCount).toBe(3);
    });

    it('returns 0 when processing directory is empty', () => {
        const recovered = recoverStuckFiles(15 * 60 * 1000);
        expect(recovered).toBe(0);
    });
});

describe('processMessage - streaming file lifecycle', () => {
    let tmpDir: string;
    let incomingDir: string;
    let processingDir: string;
    let outgoingDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-test-'));
        incomingDir = path.join(tmpDir, 'incoming');
        processingDir = path.join(tmpDir, 'processing');
        outgoingDir = path.join(tmpDir, 'outgoing');
        fs.mkdirSync(incomingDir, { recursive: true });
        fs.mkdirSync(processingDir, { recursive: true });
        fs.mkdirSync(outgoingDir, { recursive: true });

        const configMock = await import('../lib/config');
        (configMock as any).QUEUE_INCOMING = incomingDir;
        (configMock as any).QUEUE_PROCESSING = processingDir;
        (configMock as any).QUEUE_OUTGOING = outgoingDir;
        (configMock as any).QUEUE_DEAD_LETTER = path.join(tmpDir, 'dead-letter');
        (configMock as any).QUEUE_CANCEL = path.join(tmpDir, 'cancel');
        (configMock as any).MAX_RETRY_COUNT = 3;
        (configMock as any).RESET_FLAG = path.join(tmpDir, 'reset_flag');
        (configMock as any).TINYCLAW_CONFIG_WORKSPACE = path.join(tmpDir, 'workspace');

        vi.mocked(getSettings).mockReturnValue({
            agents: {
                coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
            },
        });
        vi.mocked(getAgents).mockReturnValue({
            coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
        });
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
            messageId: 'msg_stream',
            ...data,
        }));
        return filePath;
    }

    it('passes onChunk callback to invokeAgent', async () => {
        const msgFile = writeMessage({ message: 'hello', agent: 'coder' });
        await processMessage(msgFile);

        expect(invokeAgent).toHaveBeenCalledWith(
            expect.any(Object),
            'coder',
            'hello',
            expect.any(String),
            expect.any(Boolean),
            expect.any(Object),
            'msg_stream',
            undefined,
            expect.any(Function), // onChunk callback
            expect.any(AbortSignal),
        );
    });

    it('writes .streaming file when onChunk is called', async () => {
        // Make invokeAgent call the onChunk callback
        vi.mocked(invokeAgent).mockImplementation(async (...args: any[]) => {
            const onChunk = args[8];
            if (typeof onChunk === 'function') {
                onChunk('partial response');
                // Wait a bit to allow the throttle check to pass
            }
            return 'final response';
        });

        const msgFile = writeMessage({ message: 'hello', agent: 'coder' });
        await processMessage(msgFile);

        // After completion, .streaming file should be cleaned up
        const streamingFiles = fs.readdirSync(outgoingDir).filter(f => f.endsWith('.streaming'));
        expect(streamingFiles).toHaveLength(0);

        // But the final .json should exist
        const jsonFiles = fs.readdirSync(outgoingDir).filter(f => f.endsWith('.json'));
        expect(jsonFiles).toHaveLength(1);
        const response = JSON.parse(fs.readFileSync(path.join(outgoingDir, jsonFiles[0]), 'utf8'));
        expect(response.message).toBe('final response');
    });

    it('cleans up .streaming file on error', async () => {
        vi.mocked(invokeAgent).mockImplementation(async (...args: any[]) => {
            const onChunk = args[8];
            if (typeof onChunk === 'function') {
                onChunk('partial before error');
            }
            throw new Error('Agent crashed mid-stream');
        });

        const msgFile = writeMessage({ message: 'hello', agent: 'coder' });
        await processMessage(msgFile);

        // .streaming file should be cleaned up
        const streamingFiles = fs.readdirSync(outgoingDir).filter(f => f.endsWith('.streaming'));
        expect(streamingFiles).toHaveLength(0);

        // Error response should be written
        const jsonFiles = fs.readdirSync(outgoingDir).filter(f => f.endsWith('.json'));
        expect(jsonFiles).toHaveLength(1);
        const response = JSON.parse(fs.readFileSync(path.join(outgoingDir, jsonFiles[0]), 'utf8'));
        expect(response.message).toContain('error');
    });
});
