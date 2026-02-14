import fs from 'fs';
import path from 'path';
import { TINYCLAW_MEMORY_HOME } from '../lib/config';

export function writeToLongterm(text: string): void {
    const filePath = path.join(TINYCLAW_MEMORY_HOME, 'long-term.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const now = new Date();
    const timestamp = now.toISOString().slice(0, 16).replace('T', ' ');
    const entry = `\n### [${timestamp}] Manual entry\n${text}\n`;

    if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, entry);
    } else {
        fs.writeFileSync(filePath, `# Long-term Memory\n${entry}`);
    }
}
