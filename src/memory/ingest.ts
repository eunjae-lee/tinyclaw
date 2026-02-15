import fs from 'fs';
import path from 'path';
import os from 'os';
import { TINYCLAW_MEMORY_HOME, MEMORY_CURSORS_DIR, getSettings, getAgents } from '../lib/config';
import { runCommand } from '../lib/invoke';
import { log } from '../lib/logging';

interface SessionCursor {
    byteOffset: number;
    lastModified: number;
}

function getCursorPath(sessionFile: string): string {
    const encoded = sessionFile.replace(/\//g, '__');
    return path.join(MEMORY_CURSORS_DIR, `${encoded}.json`);
}

function getCursor(sessionFile: string): SessionCursor | null {
    const cursorPath = getCursorPath(sessionFile);
    if (!fs.existsSync(cursorPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(cursorPath, 'utf8'));
    } catch {
        return null;
    }
}

function saveCursor(sessionFile: string, cursor: SessionCursor): void {
    fs.mkdirSync(MEMORY_CURSORS_DIR, { recursive: true });
    const cursorPath = getCursorPath(sessionFile);
    const tmpPath = cursorPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(cursor, null, 2));
    fs.renameSync(tmpPath, cursorPath);
}

function readNewLines(sessionFile: string, cursor: SessionCursor | null): { lines: string[]; newOffset: number; newMtime: number } {
    const stat = fs.statSync(sessionFile);

    // Skip if file hasn't been modified since last processing
    if (cursor && stat.mtimeMs <= cursor.lastModified) {
        return { lines: [], newOffset: cursor.byteOffset, newMtime: cursor.lastModified };
    }

    let offset = cursor?.byteOffset ?? 0;

    // Handle file truncation/rotation
    if (offset > stat.size) {
        offset = 0;
    }

    if (offset >= stat.size) {
        return { lines: [], newOffset: offset, newMtime: stat.mtimeMs };
    }

    const fd = fs.openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buffer, 0, buffer.length, offset);
    fs.closeSync(fd);

    const newContent = buffer.toString('utf8');
    const lines = newContent.split('\n').filter(line => line.trim().length > 0);

    return { lines, newOffset: stat.size, newMtime: stat.mtimeMs };
}

interface ParsedMessage {
    role: 'user' | 'assistant';
    text: string;
}

export function preprocessJsonl(lines: string[]): string {
    const messages: ParsedMessage[] = [];

    for (const line of lines) {
        let parsed: any;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }

        const msg = parsed.message;
        if (!msg) continue;

        const role = msg.role;
        if (role !== 'user' && role !== 'assistant') continue;

        let text = '';
        if (typeof msg.content === 'string') {
            text = msg.content;
        } else if (Array.isArray(msg.content)) {
            const textParts = msg.content
                .filter((block: any) => block.type === 'text')
                .map((block: any) => block.text || '');
            text = textParts.join('\n');
        }

        text = text.trim();
        if (!text) continue;

        // Truncate long messages
        if (text.length > 500) {
            text = text.slice(0, 500) + '...';
        }

        messages.push({ role, text });
    }

    if (messages.length === 0) return '';

    return messages
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
        .join('\n\n');
}

function getClaudeProjectDir(workingDirectory: string): string {
    const encoded = workingDirectory.replace(/[/_]/g, '-');
    return path.join(os.homedir(), '.claude', 'projects', encoded);
}

async function summarizeTranscript(agentName: string, agentId: string, compactText: string, memoryThreshold: number): Promise<string> {
    const thresholdInstruction = memoryThreshold < 1
        ? `Only include items with importance score above ${memoryThreshold}.`
        : '';

    const prompt = `You are a memory system for an AI assistant team. Summarize the following session transcript into concise, actionable memory entries.

Agent: ${agentName} (${agentId})

For each notable item, provide:
- A brief description (1-2 sentences)
- An importance score from 0.0 to 1.0 (1.0 = critical decision/fact, 0.5 = useful context, 0.0 = trivial/routine)

${thresholdInstruction}

Focus on:
- Decisions made (what was decided and why)
- Problems encountered and their solutions
- New information learned about the codebase/project
- User preferences or instructions
- Tasks completed or started
- Errors/issues that may recur

Skip:
- Routine tool operations (file reads, greps) unless they reveal important findings
- Pleasantries and meta-conversation
- Implementation details that are already captured in code

Output format (use exactly this format):
### [importance: 0.X] Brief title
Description of what happened and why it matters.

If the session contains nothing worth remembering, respond with exactly: NOTHING_NOTABLE

---

Transcript:
${compactText}`;

    return runCommand('claude', ['-p', prompt, '--model', 'haiku']);
}

export async function ingestSessions(): Promise<void> {
    const settings = getSettings();
    const agents = getAgents(settings);
    const agentIds = Object.keys(agents);
    const today = new Date().toISOString().slice(0, 10);
    const dailyDir = path.join(TINYCLAW_MEMORY_HOME, 'daily');
    const dailyFile = path.join(dailyDir, `${today}.md`);

    log('INFO', `Memory ingest: starting. ${agentIds.length} agent(s) configured: [${agentIds.join(', ')}]`);
    log('INFO', `Memory ingest: daily file target = ${dailyFile}`);

    let totalProcessed = 0;
    let totalSkipped = 0;

    for (const [agentId, agent] of Object.entries(agents)) {
        const memoryWeight = agent.memory ?? 1;
        if (memoryWeight === 0) {
            log('INFO', `Memory ingest: skipping agent ${agentId} (memory=0)`);
            continue;
        }

        const workingDir = agent.working_directory;
        if (!workingDir) {
            log('INFO', `Memory ingest: skipping agent ${agentId} (no working_directory)`);
            continue;
        }

        const projectDir = getClaudeProjectDir(workingDir);
        if (!fs.existsSync(projectDir)) {
            log('INFO', `Memory ingest: skipping agent ${agentId} — project dir not found: ${projectDir}`);
            continue;
        }

        const sessionFiles = fs.readdirSync(projectDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => path.join(projectDir, f));

        log('INFO', `Memory ingest: agent ${agentId} (${agent.name}) — ${sessionFiles.length} session file(s) in ${projectDir}`);

        for (const sessionFile of sessionFiles) {
            const cursor = getCursor(sessionFile);
            const { lines, newOffset, newMtime } = readNewLines(sessionFile, cursor);

            if (lines.length === 0) {
                totalSkipped++;
                continue;
            }

            log('INFO', `Memory ingest: ${path.basename(sessionFile)} — ${lines.length} new line(s), offset ${cursor?.byteOffset ?? 0} → ${newOffset}`);

            const compactText = preprocessJsonl(lines);

            if (!compactText) {
                log('INFO', `Memory ingest: ${path.basename(sessionFile)} — no extractable messages after preprocessing`);
                saveCursor(sessionFile, { byteOffset: newOffset, lastModified: newMtime });
                continue;
            }

            log('INFO', `Memory ingest: ${path.basename(sessionFile)} — preprocessed to ${compactText.length} chars, sending to LLM for summarization`);

            try {
                const summary = await summarizeTranscript(agent.name, agentId, compactText, memoryWeight);

                if (summary.trim() === 'NOTHING_NOTABLE' || !summary.trim()) {
                    log('INFO', `Memory ingest: ${path.basename(sessionFile)} — LLM returned NOTHING_NOTABLE, skipping`);
                    saveCursor(sessionFile, { byteOffset: newOffset, lastModified: newMtime });
                    continue;
                }

                log('INFO', `Memory ingest: ${path.basename(sessionFile)} — LLM summary received (${summary.trim().length} chars)`);

                // Append to daily log
                fs.mkdirSync(dailyDir, { recursive: true });
                const time = new Date().toTimeString().slice(0, 5);
                const entry = `\n## ${agent.name} [${agentId}] (${time})\n${summary.trim()}\n\n---\n`;

                if (fs.existsSync(dailyFile)) {
                    fs.appendFileSync(dailyFile, entry);
                } else {
                    fs.writeFileSync(dailyFile, `# Daily Memory - ${today}\n${entry}`);
                }

                saveCursor(sessionFile, { byteOffset: newOffset, lastModified: newMtime });
                totalProcessed++;
                log('INFO', `Memory ingest: ingested session for ${agentId} from ${path.basename(sessionFile)}`);
            } catch (err) {
                log('WARN', `Memory ingest: failed to summarize session for ${agentId} (${path.basename(sessionFile)}): ${(err as Error).message}`);
            }
        }
    }

    log('INFO', `Memory ingest: done. ${totalProcessed} ingested, ${totalSkipped} unchanged`);
}
