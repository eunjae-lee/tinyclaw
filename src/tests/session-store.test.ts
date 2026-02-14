import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { getSession, createSession, remapSession, deleteSession, cleanupStaleSessions } from '../lib/session-store';

vi.mock('../lib/config', () => ({
    THREAD_SESSIONS_FILE: '/tmp/test-thread-sessions.json',
}));

const TEST_FILE = '/tmp/test-thread-sessions.json';

describe('session-store', () => {
    beforeEach(() => {
        // Clean up before each test
        try { fs.unlinkSync(TEST_FILE); } catch { /* ignore */ }
    });

    afterEach(() => {
        try { fs.unlinkSync(TEST_FILE); } catch { /* ignore */ }
    });

    describe('getSession', () => {
        it('returns undefined when no file exists', () => {
            expect(getSession('nonexistent')).toBeUndefined();
        });

        it('returns undefined when key not in store', () => {
            fs.writeFileSync(TEST_FILE, JSON.stringify({ other: { sessionId: 'abc', agentId: 'x', createdAt: 1 } }));
            expect(getSession('nonexistent')).toBeUndefined();
        });

        it('returns stored mapping when key exists', () => {
            const mapping = { sessionId: 'uuid-123', agentId: 'coder', createdAt: 1000 };
            fs.writeFileSync(TEST_FILE, JSON.stringify({ 'thread_1': mapping }));
            expect(getSession('thread_1')).toEqual(mapping);
        });

        it('handles corrupt file gracefully', () => {
            fs.writeFileSync(TEST_FILE, 'not valid json!!!');
            expect(getSession('anything')).toBeUndefined();
        });
    });

    describe('createSession', () => {
        it('creates a new session and returns the sessionId', () => {
            const sessionId = createSession('thread_1', 'coder');
            expect(sessionId).toBeDefined();
            expect(typeof sessionId).toBe('string');
            expect(sessionId.length).toBeGreaterThan(0);

            // Verify it's persisted
            const stored = getSession('thread_1');
            expect(stored).toBeDefined();
            expect(stored!.sessionId).toBe(sessionId);
            expect(stored!.agentId).toBe('coder');
            expect(stored!.createdAt).toBeGreaterThan(0);
        });

        it('generates unique sessionIds', () => {
            const id1 = createSession('thread_1', 'coder');
            const id2 = createSession('thread_2', 'coder');
            expect(id1).not.toBe(id2);
        });

        it('overwrites existing mapping for the same key', () => {
            const id1 = createSession('thread_1', 'coder');
            const id2 = createSession('thread_1', 'coder');
            expect(id1).not.toBe(id2);
            expect(getSession('thread_1')!.sessionId).toBe(id2);
        });
    });

    describe('remapSession', () => {
        it('copies entry from old key to new key and deletes old key', () => {
            createSession('msg_1', 'coder');
            const original = getSession('msg_1')!;

            remapSession('msg_1', 'thread_1');

            expect(getSession('msg_1')).toBeUndefined();
            expect(getSession('thread_1')).toEqual(original);
        });

        it('does nothing when old key does not exist', () => {
            createSession('thread_1', 'coder');
            remapSession('nonexistent', 'thread_2');
            expect(getSession('thread_2')).toBeUndefined();
            expect(getSession('thread_1')).toBeDefined();
        });
    });

    describe('deleteSession', () => {
        it('removes existing entry', () => {
            createSession('thread_1', 'coder');
            expect(getSession('thread_1')).toBeDefined();
            deleteSession('thread_1');
            expect(getSession('thread_1')).toBeUndefined();
        });

        it('does nothing when key does not exist', () => {
            createSession('thread_1', 'coder');
            deleteSession('nonexistent');
            expect(getSession('thread_1')).toBeDefined();
        });
    });

    describe('cleanupStaleSessions', () => {
        it('removes entries older than maxAgeMs', () => {
            // Write entries directly with old timestamps
            const store: Record<string, any> = {
                old_thread: { sessionId: 'old-uuid', agentId: 'coder', createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000 }, // 60 days ago
                new_thread: { sessionId: 'new-uuid', agentId: 'coder', createdAt: Date.now() },
            };
            fs.writeFileSync(TEST_FILE, JSON.stringify(store));

            cleanupStaleSessions(30 * 24 * 60 * 60 * 1000); // 30 days

            expect(getSession('old_thread')).toBeUndefined();
            expect(getSession('new_thread')).toBeDefined();
        });

        it('does nothing when all entries are fresh', () => {
            createSession('thread_1', 'coder');
            createSession('thread_2', 'coder');

            cleanupStaleSessions();

            expect(getSession('thread_1')).toBeDefined();
            expect(getSession('thread_2')).toBeDefined();
        });

        it('handles missing file gracefully', () => {
            expect(() => cleanupStaleSessions()).not.toThrow();
        });
    });
});
