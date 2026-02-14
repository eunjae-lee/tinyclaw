import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { splitMessage, sanitizeFileName, buildUniqueFilePath } from '../lib/discord-utils';

describe('splitMessage', () => {
    it('returns single-element array for short text', () => {
        const result = splitMessage('hello world');
        expect(result).toEqual(['hello world']);
    });

    it('splits at newline boundary when possible', () => {
        const line = 'a'.repeat(80);
        // Two lines that together exceed maxLength=100
        const text = `${line}\n${line}`;
        const result = splitMessage(text, 100);
        expect(result.length).toBeGreaterThanOrEqual(2);
        expect(result[0]).toBe(line);
    });

    it('splits at space boundary as fallback', () => {
        // No newlines, but has spaces
        const text = 'word '.repeat(50); // 250 chars
        const result = splitMessage(text.trim(), 100);
        expect(result.length).toBeGreaterThanOrEqual(2);
        // Each chunk should be <= 100 chars
        for (const chunk of result) {
            expect(chunk.length).toBeLessThanOrEqual(100);
        }
    });

    it('hard-cuts when no boundary found', () => {
        const text = 'a'.repeat(300);
        const result = splitMessage(text, 100);
        expect(result.length).toBe(3);
        expect(result[0]).toBe('a'.repeat(100));
        expect(result[1]).toBe('a'.repeat(100));
        expect(result[2]).toBe('a'.repeat(100));
    });

    it('handles custom maxLength', () => {
        const text = 'a'.repeat(50);
        const result = splitMessage(text, 25);
        expect(result.length).toBe(2);
        expect(result[0]).toBe('a'.repeat(25));
        expect(result[1]).toBe('a'.repeat(25));
    });

    it('handles empty string', () => {
        const result = splitMessage('');
        expect(result).toEqual(['']);
    });

    it('handles text exactly at maxLength', () => {
        const text = 'a'.repeat(2000);
        const result = splitMessage(text);
        expect(result).toEqual([text]);
    });
});

describe('sanitizeFileName', () => {
    it('strips illegal characters', () => {
        // path.basename splits on / first, so avoid / in the test input
        expect(sanitizeFileName('file<>:|?*.txt')).toBe('file______.txt');
    });

    it('returns "file.bin" for empty or whitespace-only names', () => {
        expect(sanitizeFileName('')).toBe('file.bin');
        expect(sanitizeFileName('   ')).toBe('file.bin');
    });

    it('preserves valid filenames', () => {
        expect(sanitizeFileName('document.pdf')).toBe('document.pdf');
        expect(sanitizeFileName('my-file_v2.tar.gz')).toBe('my-file_v2.tar.gz');
    });

    it('strips path traversal (uses basename)', () => {
        expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
        expect(sanitizeFileName('/some/path/file.txt')).toBe('file.txt');
    });
});

describe('buildUniqueFilePath', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-utils-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns base path when no conflict', () => {
        const result = buildUniqueFilePath(tmpDir, 'photo.png');
        expect(result).toBe(path.join(tmpDir, 'photo.png'));
    });

    it('appends _1, _2 counter on conflict', () => {
        // Create conflicting files
        fs.writeFileSync(path.join(tmpDir, 'photo.png'), '');
        const result1 = buildUniqueFilePath(tmpDir, 'photo.png');
        expect(result1).toBe(path.join(tmpDir, 'photo_1.png'));

        fs.writeFileSync(path.join(tmpDir, 'photo_1.png'), '');
        const result2 = buildUniqueFilePath(tmpDir, 'photo.png');
        expect(result2).toBe(path.join(tmpDir, 'photo_2.png'));
    });

    it('preserves file extension', () => {
        fs.writeFileSync(path.join(tmpDir, 'data.tar.gz'), '');
        const result = buildUniqueFilePath(tmpDir, 'data.tar.gz');
        // path.extname('data.tar.gz') is '.gz', stem is 'data.tar'
        expect(result).toBe(path.join(tmpDir, 'data.tar_1.gz'));
    });
});
