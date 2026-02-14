import fs from 'fs';
import path from 'path';
import { TINYCLAW_MEMORY_HOME, MEMORY_TMP_DIR } from '../lib/config';

export function readDaily(date?: string): string {
    const dateStr = date || new Date().toISOString().slice(0, 10);
    const filePath = path.join(TINYCLAW_MEMORY_HOME, 'daily', `${dateStr}.md`);
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
}

export function readMidterm(): string {
    const filePath = path.join(TINYCLAW_MEMORY_HOME, 'mid-term.md');
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
}

export function readLongterm(): string {
    const filePath = path.join(TINYCLAW_MEMORY_HOME, 'long-term.md');
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
}

export function getMemoryForInjection(): string {
    const midterm = readMidterm();
    const daily = readDaily();

    if (!midterm && !daily) return '';

    let content = '## Memory Context\n\n';

    if (midterm) {
        content += '### Recent Activity (Mid-term)\n';
        content += midterm + '\n\n';
    }

    if (daily) {
        content += '### Today\'s Activity\n';
        content += daily + '\n\n';
    }

    content += '---\n';
    content += '*If you need more historical context, run: `tinyclaw memory read --layer long-term`*\n';

    return content;
}

export function writeMemoryTempFile(content: string, agentId: string): string {
    fs.mkdirSync(MEMORY_TMP_DIR, { recursive: true });
    const tmpFile = path.join(MEMORY_TMP_DIR, `memory-${agentId}-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, content);
    return tmpFile;
}

export function cleanupMemoryTmpFiles(): void {
    if (!fs.existsSync(MEMORY_TMP_DIR)) return;
    const files = fs.readdirSync(MEMORY_TMP_DIR);
    const now = Date.now();
    for (const file of files) {
        const filePath = path.join(MEMORY_TMP_DIR, file);
        try {
            const stat = fs.statSync(filePath);
            // Remove files older than 1 hour
            if (now - stat.mtimeMs > 3600_000) {
                fs.unlinkSync(filePath);
            }
        } catch {
            // Ignore cleanup errors
        }
    }
}
