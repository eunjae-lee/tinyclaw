import crypto from 'crypto';
import fs from 'fs';
import lockfile from 'proper-lockfile';
import { SessionMapping } from './types';
import { THREAD_SESSIONS_FILE } from './config';

/**
 * Persistent session mapping store.
 *
 * Always re-reads from disk on getSession() (no in-memory cache) because
 * discord-client and queue-processor run in separate processes and both
 * need to see each other's writes.
 *
 * All mutating operations use file-level locking (proper-lockfile) to
 * prevent lost updates when discord-client and queue-processor write
 * concurrently.
 */

function ensureFile(): void {
    if (!fs.existsSync(THREAD_SESSIONS_FILE)) {
        fs.mkdirSync(require('path').dirname(THREAD_SESSIONS_FILE), { recursive: true });
        fs.writeFileSync(THREAD_SESSIONS_FILE, '{}');
    }
}

function withLock<T>(fn: () => T): T {
    ensureFile();
    const maxAttempts = 6;
    const delay = 50;
    let release: (() => void) | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            release = lockfile.lockSync(THREAD_SESSIONS_FILE, { stale: 10000 });
            break;
        } catch (err: any) {
            if (err.code === 'ELOCKED' && attempt < maxAttempts - 1) {
                const ms = delay * Math.pow(2, attempt);
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
                continue;
            }
            throw err;
        }
    }
    try {
        return fn();
    } finally {
        release?.();
    }
}

function readStore(): Record<string, SessionMapping> {
    try {
        return JSON.parse(fs.readFileSync(THREAD_SESSIONS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function writeStore(store: Record<string, SessionMapping>): void {
    try {
        fs.writeFileSync(THREAD_SESSIONS_FILE, JSON.stringify(store, null, 2));
    } catch {
        // Best-effort — don't crash on write failure
    }
}

export function getSession(sessionKey: string): SessionMapping | undefined {
    const store = readStore();
    return store[sessionKey];
}

export function createSession(sessionKey: string, agentId: string): string {
    return withLock(() => {
        const store = readStore();
        const sessionId = crypto.randomUUID();
        store[sessionKey] = { sessionId, agentId, createdAt: Date.now() };
        writeStore(store);
        return sessionId;
    });
}

export function remapSession(oldKey: string, newKey: string): void {
    withLock(() => {
        const store = readStore();
        const entry = store[oldKey];
        if (!entry) return;
        store[newKey] = entry;
        delete store[oldKey];
        writeStore(store);
    });
}

export function deleteSession(sessionKey: string): void {
    withLock(() => {
        const store = readStore();
        if (!(sessionKey in store)) return;
        delete store[sessionKey];
        writeStore(store);
    });
}

export function cleanupStaleSessions(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): void {
    withLock(() => {
        const store = readStore();
        const now = Date.now();
        let changed = false;
        for (const key of Object.keys(store)) {
            if (now - store[key].createdAt > maxAgeMs) {
                delete store[key];
                changed = true;
            }
        }
        if (changed) {
            writeStore(store);
        }
    });
}
