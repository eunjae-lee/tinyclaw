import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { tmpDir } = vi.hoisted(() => {
    const os = require('os');
    const path = require('path');
    const tmpDir = path.join(os.tmpdir(), 'tinyclaw-test-memory-read');
    return { tmpDir };
});

vi.mock('../lib/config', () => ({
    TINYCLAW_MEMORY_HOME: tmpDir,
    MEMORY_TMP_DIR: tmpDir + '/tmp',
}));

import { readDaily, readMidterm, readLongterm, getMemoryForInjection, writeMemoryTempFile, cleanupMemoryTmpFiles } from '../memory/read';

describe('memory read', () => {
    beforeEach(() => {
        fs.mkdirSync(path.join(tmpDir, 'daily'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'tmp'), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('readDaily', () => {
        it('returns empty string when file does not exist', () => {
            expect(readDaily('2026-01-01')).toBe('');
        });

        it('reads daily file content', () => {
            const dailyFile = path.join(tmpDir, 'daily', '2026-02-14.md');
            fs.writeFileSync(dailyFile, '# Daily Memory\nSome content');
            expect(readDaily('2026-02-14')).toBe('# Daily Memory\nSome content');
        });
    });

    describe('readMidterm', () => {
        it('returns empty string when file does not exist', () => {
            expect(readMidterm()).toBe('');
        });

        it('reads mid-term file content', () => {
            fs.writeFileSync(path.join(tmpDir, 'mid-term.md'), 'Mid-term content');
            expect(readMidterm()).toBe('Mid-term content');
        });
    });

    describe('readLongterm', () => {
        it('returns empty string when file does not exist', () => {
            expect(readLongterm()).toBe('');
        });

        it('reads long-term file content', () => {
            fs.writeFileSync(path.join(tmpDir, 'long-term.md'), 'Long-term content');
            expect(readLongterm()).toBe('Long-term content');
        });
    });

    describe('getMemoryForInjection', () => {
        it('returns empty string when no memory files exist', () => {
            expect(getMemoryForInjection()).toBe('');
        });

        it('combines mid-term and daily content', () => {
            fs.writeFileSync(path.join(tmpDir, 'mid-term.md'), 'Mid-term stuff');
            fs.writeFileSync(path.join(tmpDir, 'daily', new Date().toISOString().slice(0, 10) + '.md'), 'Today stuff');

            const result = getMemoryForInjection();
            expect(result).toContain('Mid-term stuff');
            expect(result).toContain('Today stuff');
            expect(result).toContain('Recent Activity (Mid-term)');
            expect(result).toContain("Today's Activity");
        });

        it('includes instruction about long-term access', () => {
            fs.writeFileSync(path.join(tmpDir, 'mid-term.md'), 'Some content');
            const result = getMemoryForInjection();
            expect(result).toContain('tinyclaw memory read --layer long-term');
        });

        it('handles missing daily file gracefully', () => {
            fs.writeFileSync(path.join(tmpDir, 'mid-term.md'), 'Mid-term only');
            const result = getMemoryForInjection();
            expect(result).toContain('Mid-term only');
            expect(result).not.toContain("Today's Activity");
        });

        it('handles missing mid-term file gracefully', () => {
            fs.writeFileSync(path.join(tmpDir, 'daily', new Date().toISOString().slice(0, 10) + '.md'), 'Daily only');
            const result = getMemoryForInjection();
            expect(result).toContain('Daily only');
            expect(result).not.toContain('Recent Activity (Mid-term)');
        });
    });

    describe('writeMemoryTempFile', () => {
        it('writes content to a temp file and returns the path', () => {
            const filePath = writeMemoryTempFile('test content', 'agent1');
            expect(fs.existsSync(filePath)).toBe(true);
            expect(fs.readFileSync(filePath, 'utf8')).toBe('test content');
            expect(filePath).toContain('memory-agent1-');
        });
    });

    describe('cleanupMemoryTmpFiles', () => {
        it('removes files older than 1 hour', () => {
            const oldFile = path.join(tmpDir, 'tmp', 'old-file.md');
            fs.writeFileSync(oldFile, 'old');
            // Set mtime to 2 hours ago
            const twoHoursAgo = new Date(Date.now() - 7200_000);
            fs.utimesSync(oldFile, twoHoursAgo, twoHoursAgo);

            const newFile = path.join(tmpDir, 'tmp', 'new-file.md');
            fs.writeFileSync(newFile, 'new');

            cleanupMemoryTmpFiles();

            expect(fs.existsSync(oldFile)).toBe(false);
            expect(fs.existsSync(newFile)).toBe(true);
        });

        it('does nothing when tmp dir does not exist', () => {
            fs.rmSync(path.join(tmpDir, 'tmp'), { recursive: true, force: true });
            expect(() => cleanupMemoryTmpFiles()).not.toThrow();
        });
    });
});
