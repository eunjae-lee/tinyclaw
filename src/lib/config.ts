import fs from 'fs';
import path from 'path';
import { Settings, Credentials, AgentConfig, TeamConfig, PermissionConfig, CLAUDE_MODEL_IDS, CODEX_MODEL_IDS } from './types';

export const SCRIPT_DIR = path.resolve(__dirname, '../..');
export const TINYCLAW_CONFIG_HOME = process.env.TINYCLAW_CONFIG_HOME
    || path.join(require('os').homedir(), '.tinyclaw', 'config');
export const TINYCLAW_CONFIG_WORKSPACE = process.env.TINYCLAW_CONFIG_WORKSPACE
    || path.join(require('os').homedir(), '.tinyclaw', 'workspace');
export const TINYCLAW_MEMORY_HOME = process.env.TINYCLAW_MEMORY_HOME
    || path.join(require('os').homedir(), 'workspace', 'everything', 'tinyclaw', 'memory');
export const MEMORY_CURSORS_DIR = path.join(TINYCLAW_CONFIG_HOME, 'memory-cursors');
export const MEMORY_TMP_DIR = path.join(TINYCLAW_CONFIG_HOME, 'memory-tmp');

// Config paths (from TINYCLAW_CONFIG_HOME)
export const SETTINGS_FILE = path.join(TINYCLAW_CONFIG_HOME, 'settings.json');
export const CREDENTIALS_FILE = path.join(TINYCLAW_CONFIG_HOME, 'credentials.json');

// Runtime/data paths (from TINYCLAW_CONFIG_HOME — these are operational data, not agent workspaces)
export const QUEUE_INCOMING = path.join(TINYCLAW_CONFIG_HOME, 'queue/incoming');
export const QUEUE_OUTGOING = path.join(TINYCLAW_CONFIG_HOME, 'queue/outgoing');
export const QUEUE_PROCESSING = path.join(TINYCLAW_CONFIG_HOME, 'queue/processing');
export const LOG_FILE = path.join(TINYCLAW_CONFIG_HOME, 'logs/queue.log');
export const RESET_FLAG = path.join(TINYCLAW_CONFIG_HOME, 'reset_flag');
export const EVENTS_DIR = path.join(TINYCLAW_CONFIG_HOME, 'events');
export const CHATS_DIR = path.join(TINYCLAW_CONFIG_HOME, 'chats');
export const APPROVALS_DIR = path.join(TINYCLAW_CONFIG_HOME, 'approvals');
export const APPROVALS_PENDING = path.join(APPROVALS_DIR, 'pending');
export const APPROVALS_DECISIONS = path.join(APPROVALS_DIR, 'decisions');

export function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings: Settings = JSON.parse(settingsData);

        // Auto-detect provider if not specified
        if (!settings?.models?.provider) {
            if (settings?.models?.openai) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'openai';
            } else if (settings?.models?.anthropic) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'anthropic';
            }
        }

        return settings;
    } catch {
        return {};
    }
}

export function getCredentials(): Credentials {
    // Primary: read from credentials.json
    if (fs.existsSync(CREDENTIALS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
        } catch {
            return {};
        }
    }

    // Fallback: read bot_token from settings.json for backward compatibility
    try {
        const settingsData = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        const credentials: Credentials = {};

        if (settingsData.channels?.discord?.bot_token) {
            credentials.channels = {
                discord: {
                    bot_token: settingsData.channels.discord.bot_token,
                },
            };
            console.warn(
                '[tinyclaw] Warning: bot_token found in settings.json instead of credentials.json. ' +
                'Run the setup wizard or move bot_token to credentials.json.'
            );
        }

        return credentials;
    } catch {
        return {};
    }
}

/**
 * Build the default agent config from the legacy models section.
 * Used when no agents are configured, for backwards compatibility.
 */
export function getDefaultAgentFromModels(settings: Settings): AgentConfig {
    const provider = settings?.models?.provider || 'anthropic';
    let model = '';
    if (provider === 'openai') {
        model = settings?.models?.openai?.model || 'gpt-5.3-codex';
    } else {
        model = settings?.models?.anthropic?.model || 'sonnet';
    }

    // Get workspace path from settings or use default
    const workspacePath = settings?.workspace?.path || TINYCLAW_CONFIG_WORKSPACE;
    const defaultAgentDir = path.join(workspacePath, 'default');

    return {
        name: 'Default',
        provider,
        model,
        working_directory: defaultAgentDir,
    };
}

/**
 * Get all configured agents. Falls back to a single "default" agent
 * derived from the legacy models section if no agents are configured.
 */
export function getAgents(settings: Settings): Record<string, AgentConfig> {
    if (settings.agents && Object.keys(settings.agents).length > 0) {
        return settings.agents;
    }
    // Fall back to default agent from models section
    return { default: getDefaultAgentFromModels(settings) };
}

/**
 * Get all configured teams.
 */
export function getTeams(settings: Settings): Record<string, TeamConfig> {
    return settings.teams || {};
}

/**
 * Resolve the model ID for Claude (Anthropic).
 */
export function resolveClaudeModel(model: string): string {
    return CLAUDE_MODEL_IDS[model] || model || '';
}

/**
 * Resolve the model ID for Codex (OpenAI).
 */
export function resolveCodexModel(model: string): string {
    return CODEX_MODEL_IDS[model] || model || '';
}

/**
 * Resolve permissions for a given agent.
 * Merges global defaults with agent-specific overrides.
 * Agent-level allowedTools/deniedTools replace (not merge with) global ones when present.
 * deniedTools are filtered out of allowedTools.
 */
export function resolvePermissions(settings: Settings, agentId: string): PermissionConfig {
    const globalPerms = settings.permissions || {};
    const agents = getAgents(settings);
    const agentPerms = agents[agentId]?.permissions || {};

    // Agent-level overrides global when present
    const allowedTools = agentPerms.allowedTools ?? globalPerms.allowedTools ?? [];
    const deniedTools = agentPerms.deniedTools ?? globalPerms.deniedTools ?? [];

    // Filter denied tools out of allowed tools
    const filtered = allowedTools.filter(tool => !deniedTools.includes(tool));

    return { allowedTools: filtered, deniedTools };
}
