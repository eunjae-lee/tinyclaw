import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { tmpDir } = vi.hoisted(() => {
    const os = require('os');
    const path = require('path');
    const tmpDir = path.join(os.tmpdir(), 'tinyclaw-test-memory-write');
    return { tmpDir };
});

vi.mock('../lib/config', () => ({
    TINYCLAW_MEMORY_HOME: tmpDir,
}));

import { writeToLongterm } from '../memory/write';

describe('memory write', () => {
    beforeEach(() => {
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates long-term.md if it does not exist', () => {
        writeToLongterm('Test fact');
        const content = fs.readFileSync(path.join(tmpDir, 'long-term.md'), 'utf8');
        expect(content).toContain('# Long-term Memory');
        expect(content).toContain('Test fact');
        expect(content).toContain('Manual entry');
    });

    it('appends to existing long-term.md', () => {
        fs.writeFileSync(path.join(tmpDir, 'long-term.md'), '# Long-term Memory\n\nExisting content\n');
        writeToLongterm('New fact');
        const content = fs.readFileSync(path.join(tmpDir, 'long-term.md'), 'utf8');
        expect(content).toContain('Existing content');
        expect(content).toContain('New fact');
    });

    it('includes timestamp in entry', () => {
        writeToLongterm('Timestamped fact');
        const content = fs.readFileSync(path.join(tmpDir, 'long-term.md'), 'utf8');
        // Should contain a timestamp like [2026-02-14 10:30]
        expect(content).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/);
    });

    it('creates memory directory if it does not exist', () => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        writeToLongterm('Create dir test');
        expect(fs.existsSync(path.join(tmpDir, 'long-term.md'))).toBe(true);
    });
});
