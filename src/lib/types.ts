export interface PermissionConfig {
    allowedTools?: string[];   // e.g. ["Read", "Grep", "Glob", "Write", "Edit"]
    deniedTools?: string[];    // explicit deny (takes precedence over allowed)
}

export interface AgentConfig {
    name: string;
    provider: string;       // 'anthropic' or 'openai'
    model: string;           // e.g. 'sonnet', 'opus', 'gpt-5.3-codex'
    working_directory: string;
    permissions?: PermissionConfig;
    memory?: number;         // 0-1 (default 1). 0 = skip. Values between act as importance threshold.
}

export interface TeamConfig {
    name: string;
    agents: string[];
    leader_agent: string;
}

export interface ChainStep {
    agentId: string;
    response: string;
}

export interface Credentials {
    channels?: {
        discord?: {
            bot_token?: string;
        };
    };
}

export interface Settings {
    workspace?: {
        path?: string;
        name?: string;
    };
    channels?: {
        enabled?: string[];
        discord?: {
            allowed_channels?: Array<string | { channelId: string; defaultAgent: string }>;
            heartbeat_channel?: string;
        };
    };
    admin_user_id?: string;  // Discord user ID for approval requests
    models?: {
        provider?: string; // 'anthropic' or 'openai'
        anthropic?: {
            model?: string;
        };
        openai?: {
            model?: string;
        };
    };
    agents?: Record<string, AgentConfig>;
    teams?: Record<string, TeamConfig>;
    permissions?: PermissionConfig;
    approvals?: {
        timeout?: number;      // seconds to wait for approval (default: 300)
    };
    monitoring?: {
        heartbeat_interval?: number;
        active_hours?: Array<{
            days: string[];    // e.g. ["mon","tue","wed","thu","fri"]
            start: string;     // e.g. "09:00"
            end: string;       // e.g. "22:00"
        }>;
    };
}

export interface MessageData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    timestamp: number;
    messageId: string;
    agent?: string; // optional: pre-routed agent id from channel client
    files?: string[];
    sessionKey?: string; // per-thread/DM session isolation key
    retryCount?: number; // tracks processing retry attempts
}

export interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    agent?: string; // which agent handled this
    files?: string[];
}

export interface QueueFile {
    name: string;
    path: string;
    time: number;
}

// Model name mapping
export const CLAUDE_MODEL_IDS: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5',
    'opus': 'claude-opus-4-6',
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'claude-opus-4-6': 'claude-opus-4-6'
};

export const CODEX_MODEL_IDS: Record<string, string> = {
    'gpt-5.2': 'gpt-5.2',
    'gpt-5.3-codex': 'gpt-5.3-codex',
};
