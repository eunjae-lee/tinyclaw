#!/usr/bin/env node
/**
 * TinyClaw PreToolUse Approval Hook
 *
 * Called by Claude Code before each tool use. Reads JSON on stdin.
 * Checks if tool is pre-approved (globally or per-agent); if not, writes
 * a pending approval file and polls for a decision from the Discord client.
 */

import fs from 'fs';
import path from 'path';

// --- Types ---

interface HookInput {
    tool_name?: string;
    tool_input?: {
        command?: string;
        [key: string]: unknown;
    };
}

interface PendingApproval {
    request_id: string;
    tool_name: string;
    tool_pattern: string;
    tool_input_summary: string;
    agent_id: string;
    message_id: string;
    timestamp: number;
    notified: boolean;
}

interface Decision {
    decision: string;
    tool_name?: string;
}

// --- Constants ---

const TINYCLAW_CONFIG_HOME = process.env.TINYCLAW_CONFIG_HOME
    || path.join(require('os').homedir(), '.tinyclaw', 'config');
const SETTINGS_FILE = path.join(TINYCLAW_CONFIG_HOME, 'settings.json');
const AGENT_ID = process.env.TINYCLAW_AGENT_ID || 'default';
const MESSAGE_ID = process.env.TINYCLAW_MESSAGE_ID || '';

const HOOK_LOG_FILE = path.join(TINYCLAW_CONFIG_HOME, 'logs', 'approval-hook.log');

function hookLog(msg: string): void {
    try {
        const ts = new Date().toISOString();
        fs.appendFileSync(HOOK_LOG_FILE, `[${ts}] [agent:${AGENT_ID}] ${msg}\n`);
    } catch { /* ignore */ }
}

const APPROVALS_DIR = path.join(TINYCLAW_CONFIG_HOME, 'approvals');
const PENDING_DIR = path.join(APPROVALS_DIR, 'pending');
const DECISIONS_DIR = path.join(APPROVALS_DIR, 'decisions');

/** Tools that have meaningful subcommands (e.g. git status, npm install) */
const SUBCMD_TOOLS = new Set([
    'git', 'gh', 'npm', 'npx', 'docker', 'kubectl', 'cargo',
    'make', 'yarn', 'pnpm', 'bun', 'brew', 'pip', 'pip3', 'conda',
]);

// --- Helpers ---

function allow(): never {
    const output = JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
        },
    });
    process.stdout.write(output);
    process.exit(0);
}

function deny(): never {
    const output = JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'Denied by TinyClaw approval hook',
        },
    });
    process.stdout.write(output);
    process.exit(0);
}

function readJsonFile<T>(filePath: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Compute the granular tool pattern for a tool use.
 * For Bash commands, produces patterns like "Bash(pwd:*)" or "Bash(git status:*)".
 * For other tools, returns the tool name as-is (e.g. "Read", "Write").
 */
function computeToolPattern(toolName: string, toolInput: HookInput['tool_input']): { pattern: string; bashCmd: string } {
    if (toolName !== 'Bash' || !toolInput?.command) {
        return { pattern: toolName, bashCmd: '' };
    }

    const bashCmd = toolInput.command;
    const words = bashCmd.split(/\s+/);
    const word1 = words[0] || '';
    const word2 = words[1] || '';

    if (word2 && !word2.startsWith('-') && SUBCMD_TOOLS.has(word1)) {
        return { pattern: `Bash(${word1} ${word2}:*)`, bashCmd };
    }
    return { pattern: `Bash(${word1}:*)`, bashCmd };
}

/**
 * Check if a tool use matches a permission pattern.
 * Patterns can be:
 *   - Exact tool name: "Read", "Write", "Bash"
 *   - Bash prefix pattern: "Bash(pwd:*)", "Bash(git status:*)"
 */
function matchesPattern(pattern: string, toolName: string, bashCmd: string): boolean {
    // Bash prefix pattern: Bash(prefix:*)
    const match = pattern.match(/^Bash\((.+):\*\)$/);
    if (match) {
        const prefix = match[1];
        return toolName === 'Bash' && bashCmd.startsWith(prefix);
    }

    // Exact tool name match
    return pattern === toolName;
}

/**
 * Check if the tool is allowed by a list of permission patterns.
 */
function isAllowedByPatterns(patterns: string[], toolName: string, bashCmd: string): boolean {
    return patterns.some(p => matchesPattern(p, toolName, bashCmd));
}

// --- Main ---

async function main(): Promise<void> {
    // Read JSON from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    const input: HookInput = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    const toolName = input.tool_name;
    hookLog(`Hook invoked for tool: ${toolName || '(none)'} cwd=${process.cwd()}`);

    if (!toolName) {
        hookLog('No tool name — allowing');
        allow();
    }

    // If no settings file, allow everything
    if (!fs.existsSync(SETTINGS_FILE)) {
        allow();
    }

    const settings = readJsonFile<Record<string, any>>(SETTINGS_FILE);
    if (!settings) {
        allow();
    }

    // Compute tool pattern early (used for matching and display)
    const { pattern: toolPattern, bashCmd } = computeToolPattern(toolName!, input.tool_input);

    // --- Permission check layer 1: TinyClaw global/agent allowedTools ---
    const agentPerms = settings!.agents?.[AGENT_ID]?.permissions?.allowedTools as string[] | undefined;
    const globalPerms = settings!.permissions?.allowedTools as string[] | undefined;
    const allowedTools = agentPerms ?? globalPerms ?? [];

    if (allowedTools.length === 0) {
        // No allowed tools configured at all — allow everything (no restrictions)
        allow();
    }

    if (isAllowedByPatterns(allowedTools, toolName!, bashCmd)) {
        hookLog(`Tool ${toolName} matched allowedTools pattern — allowing`);
        allow();
    }

    // --- Permission check layer 2: Agent's .claude/settings.json permissions.allow ---
    const agentDir = settings!.agents?.[AGENT_ID]?.working_directory as string | undefined;
    if (agentDir) {
        const claudeSettingsFile = path.join(agentDir, '.claude', 'settings.json');
        const claudeSettings = readJsonFile<Record<string, any>>(claudeSettingsFile);
        const agentAllow = (claudeSettings?.permissions?.allow ?? []) as string[];
        if (agentAllow.length > 0 && isAllowedByPatterns(agentAllow, toolName!, bashCmd)) {
            allow();
        }
    }

    hookLog(`Tool ${toolName} (pattern: ${toolPattern}) NOT pre-approved — requesting approval`);
    // --- Tool is NOT pre-approved — request approval via file-based IPC ---

    fs.mkdirSync(PENDING_DIR, { recursive: true });
    fs.mkdirSync(DECISIONS_DIR, { recursive: true });

    const requestId = `${Math.floor(Date.now() / 1000)}_${process.pid}`;

    // Extract a short summary of tool_input for the approval message
    const toolInputSummary = JSON.stringify(input.tool_input ?? {}).substring(0, 500);

    const pending: PendingApproval = {
        request_id: requestId,
        tool_name: toolName!,
        tool_pattern: toolPattern,
        tool_input_summary: toolInputSummary,
        agent_id: AGENT_ID,
        message_id: MESSAGE_ID,
        timestamp: Math.floor(Date.now() / 1000),
        notified: false,
    };

    fs.writeFileSync(
        path.join(PENDING_DIR, `${requestId}.json`),
        JSON.stringify(pending, null, 4),
    );

    // Read timeout from settings (default 300 seconds)
    const timeout = (settings!.approvals?.timeout as number) ?? 300;
    const pollInterval = 2000; // ms
    const deadline = Date.now() + timeout * 1000;

    // Poll for decision
    while (Date.now() < deadline) {
        const decisionFile = path.join(DECISIONS_DIR, `${requestId}.json`);

        if (fs.existsSync(decisionFile)) {
            const decision = readJsonFile<Decision>(decisionFile);
            const action = decision?.decision || 'deny';

            // Clean up files
            try { fs.unlinkSync(path.join(PENDING_DIR, `${requestId}.json`)); } catch {}
            try { fs.unlinkSync(decisionFile); } catch {}

            switch (action) {
                case 'allow':
                    allow();
                    break;

                case 'always_allow':
                    // Persist to agent's .claude/settings.json permissions.allow
                    if (agentDir && fs.existsSync(agentDir)) {
                        const claudeSettingsFile = path.join(agentDir, '.claude', 'settings.json');
                        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
                        const existing = readJsonFile<Record<string, any>>(claudeSettingsFile) ?? {};
                        const currentAllow = (existing.permissions?.allow ?? []) as string[];
                        if (!currentAllow.includes(toolPattern)) {
                            currentAllow.push(toolPattern);
                        }
                        existing.permissions = { ...existing.permissions, allow: currentAllow };
                        fs.writeFileSync(claudeSettingsFile, JSON.stringify(existing, null, 2));
                    }
                    allow();
                    break;

                case 'always_allow_all':
                    // Persist to TinyClaw's global allowedTools
                    const currentGlobal = (settings!.permissions?.allowedTools ?? []) as string[];
                    if (!currentGlobal.includes(toolPattern)) {
                        currentGlobal.push(toolPattern);
                    }
                    settings!.permissions = { ...settings!.permissions, allowedTools: currentGlobal };
                    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
                    allow();
                    break;

                default:
                    deny();
            }
        }

        await sleep(pollInterval);
    }

    // Timeout — deny and clean up
    try { fs.unlinkSync(path.join(PENDING_DIR, `${requestId}.json`)); } catch {}
    deny();
}

main().catch(() => {
    deny();
});
