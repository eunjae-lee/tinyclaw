import fs from 'fs';
import path from 'path';
import { AgentConfig } from './types';
import { SCRIPT_DIR, APPROVALS_DIR, APPROVALS_PENDING, APPROVALS_DECISIONS } from './config';

/**
 * Recursively copy directory
 */
export function copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Ensure agent directory exists with template files copied from TINYCLAW_CONFIG_HOME.
 * Creates directory if it doesn't exist and copies .claude/, templates/heartbeat.md, and CLAUDE.md.
 */
export function ensureAgentDirectory(agentDir: string): void {
    if (fs.existsSync(agentDir)) {
        return; // Directory already exists
    }

    fs.mkdirSync(agentDir, { recursive: true });

    // Copy .claude directory
    const sourceClaudeDir = path.join(SCRIPT_DIR, '.claude');
    const targetClaudeDir = path.join(agentDir, '.claude');
    if (fs.existsSync(sourceClaudeDir)) {
        copyDirSync(sourceClaudeDir, targetClaudeDir);
    }

    // Copy heartbeat.md
    const sourceHeartbeat = path.join(SCRIPT_DIR, 'templates', 'heartbeat.md');
    const targetHeartbeat = path.join(agentDir, 'heartbeat.md');
    if (fs.existsSync(sourceHeartbeat)) {
        fs.copyFileSync(sourceHeartbeat, targetHeartbeat);
    }

    // Copy CLAUDE.md template to agent root
    const sourceClaudeMd = path.join(SCRIPT_DIR, 'templates', 'CLAUDE.md');
    const targetClaudeMd = path.join(agentDir, 'CLAUDE.md');
    if (fs.existsSync(sourceClaudeMd)) {
        fs.copyFileSync(sourceClaudeMd, targetClaudeMd);
    }

    // Copy .gitignore
    const sourceGitignore = path.join(SCRIPT_DIR, 'templates', 'agent.gitignore');
    const targetGitignore = path.join(agentDir, '.gitignore');
    if (fs.existsSync(sourceGitignore)) {
        fs.copyFileSync(sourceGitignore, targetGitignore);
    }

    // Symlink skills directory into .claude/skills
    const sourceSkills = path.join(SCRIPT_DIR, '.agents', 'skills');
    const targetSkills = path.join(agentDir, '.claude', 'skills');
    if (fs.existsSync(sourceSkills) && !fs.existsSync(targetSkills)) {
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
        fs.symlinkSync(sourceSkills, targetSkills);
    }

    // Configure approval hook
    configureApprovalHook(agentDir);
}

/**
 * Configure the PreToolUse approval hook in the agent's .claude/settings.local.json.
 * Ensures the approval hook is registered for all tool uses.
 * Uses settings.local.json since the hook path is machine-specific (git-ignored by Claude Code).
 * Also ensures the approvals directories exist.
 */
export function configureApprovalHook(agentDir: string): void {
    // Ensure approvals directories exist
    [APPROVALS_DIR, APPROVALS_PENDING, APPROVALS_DECISIONS].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    const hookScript = path.join(SCRIPT_DIR, 'dist', 'lib', 'approval-hook.js');
    if (!fs.existsSync(hookScript)) {
        return; // Hook script not present, skip configuration
    }

    const claudeSettingsDir = path.join(agentDir, '.claude');
    const claudeLocalFile = path.join(claudeSettingsDir, 'settings.local.json');

    // Read existing local settings or start fresh
    let settings: Record<string, any> = {};
    if (fs.existsSync(claudeLocalFile)) {
        try {
            settings = JSON.parse(fs.readFileSync(claudeLocalFile, 'utf8'));
        } catch {
            settings = {};
        }
    }

    // Add hooks config (preserve other fields)
    settings.hooks = {
        PreToolUse: [
            {
                matcher: '.*',
                hooks: [
                    {
                        type: 'command',
                        command: `node ${hookScript}`,
                        timeout: 600,
                    },
                ],
            },
        ],
    };

    fs.mkdirSync(claudeSettingsDir, { recursive: true });
    fs.writeFileSync(claudeLocalFile, JSON.stringify(settings, null, 2));
}

