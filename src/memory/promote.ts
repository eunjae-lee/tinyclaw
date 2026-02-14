import fs from 'fs';
import path from 'path';
import { TINYCLAW_MEMORY_HOME } from '../lib/config';
import { runCommand } from '../lib/invoke';
import { log } from '../lib/logging';

function getDailyFiles(days: number): { date: string; content: string }[] {
    const dailyDir = path.join(TINYCLAW_MEMORY_HOME, 'daily');
    if (!fs.existsSync(dailyDir)) return [];

    const results: { date: string; content: string }[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().slice(0, 10);
        const filePath = path.join(dailyDir, `${dateStr}.md`);

        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            if (content.trim()) {
                results.push({ date: dateStr, content });
            }
        }
    }

    return results.reverse(); // Chronological order
}

export async function promoteDailyToMidterm(): Promise<void> {
    const dailyFiles = getDailyFiles(7);

    if (dailyFiles.length === 0) {
        log('INFO', 'Memory: no daily logs found for mid-term promotion');
        const midtermPath = path.join(TINYCLAW_MEMORY_HOME, 'mid-term.md');
        fs.mkdirSync(path.dirname(midtermPath), { recursive: true });
        fs.writeFileSync(midtermPath, '# Mid-term Memory\n\nNo recent activity.\n');
        return;
    }

    const concatenated = dailyFiles
        .map(f => `--- ${f.date} ---\n${f.content}`)
        .join('\n\n');

    const prompt = `You are a memory system for an AI assistant team. Summarize the following daily logs from the past 7 days into a cohesive rolling summary of approximately 1000 tokens.

Structure the summary as:
1. **Active Projects**: What's being worked on across agents
2. **Recent Decisions**: Key decisions made in the past week
3. **Open Issues**: Problems or tasks that are still unresolved
4. **User Preferences**: Any preferences or patterns observed

Keep entries concise and actionable. Prioritize recent information over older entries. If conflicting information exists, use the most recent version.

Do not include any preamble or meta-commentary. Output only the summary content.

---

Daily logs:
${concatenated}`;

    try {
        const summary = await runCommand('claude', ['-p', prompt, '--model', 'haiku']);
        const midtermPath = path.join(TINYCLAW_MEMORY_HOME, 'mid-term.md');
        fs.mkdirSync(path.dirname(midtermPath), { recursive: true });

        const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const dateRange = `${dailyFiles[0].date} to ${dailyFiles[dailyFiles.length - 1].date}`;
        const content = `# Mid-term Memory\n*Generated: ${now}*\n*Covering: ${dateRange}*\n\n${summary.trim()}\n`;

        fs.writeFileSync(midtermPath, content);
        log('INFO', `Memory: promoted ${dailyFiles.length} daily logs to mid-term.md`);
    } catch (err) {
        log('WARN', `Memory: failed to promote daily to mid-term: ${(err as Error).message}`);
    }
}

export async function promoteToLongterm(): Promise<void> {
    const midtermPath = path.join(TINYCLAW_MEMORY_HOME, 'mid-term.md');
    const longtermPath = path.join(TINYCLAW_MEMORY_HOME, 'long-term.md');

    const midterm = fs.existsSync(midtermPath)
        ? fs.readFileSync(midtermPath, 'utf8')
        : '';

    if (!midterm.trim()) {
        log('INFO', 'Memory: no mid-term content for long-term promotion');
        return;
    }

    const longterm = fs.existsSync(longtermPath)
        ? fs.readFileSync(longtermPath, 'utf8')
        : '';

    const prompt = `You are a memory system for an AI assistant team. Review the mid-term summary and current long-term memory below. Identify any new DURABLE facts, settled decisions, or stable preferences that should be added to long-term memory.

Rules:
- Only add items that are settled/stable (not in flux)
- Do not duplicate items already in long-term memory
- Update existing items only if the information has genuinely changed
- Remove items from long-term memory that are clearly obsolete
- Keep each entry concise (1-2 sentences)

Output the complete updated long-term memory document. Use this structure:
## Project Facts
## User Preferences
## Architecture Decisions

Do not include any preamble. Output only the long-term memory content.

---

Current long-term memory:
${longterm || '(empty - this is the first long-term memory entry)'}

---

Mid-term summary (recent activity):
${midterm}`;

    try {
        const result = await runCommand('claude', ['-p', prompt, '--model', 'haiku']);

        fs.mkdirSync(path.dirname(longtermPath), { recursive: true });
        const now = new Date().toISOString().slice(0, 10);
        const content = `# Long-term Memory\n*Last updated: ${now}*\n\n${result.trim()}\n`;

        fs.writeFileSync(longtermPath, content);
        log('INFO', 'Memory: promoted mid-term to long-term.md');
    } catch (err) {
        log('WARN', `Memory: failed to promote to long-term: ${(err as Error).message}`);
    }
}
