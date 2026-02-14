import path from 'path';
import { AgentConfig } from './types';

/**
 * Extract the !agent_id prefix from a raw message string.
 * Returns the agent ID (lowercased) or undefined if no prefix found.
 */
export function extractAgentPrefix(text: string): string | undefined {
    const match = text.match(/^!(\S+)\s+/);
    return match ? match[1].toLowerCase() : undefined;
}

/**
 * Get the reset flag path for a specific agent.
 */
export function getAgentResetFlag(agentId: string, workspacePath: string): string {
    return path.join(workspacePath, agentId, 'reset_flag');
}

/**
 * Parse !agent_id prefix from a message.
 * Returns { agentId, message } where message has the prefix stripped.
 */
export function parseAgentRouting(
    rawMessage: string,
    agents: Record<string, AgentConfig>
): { agentId: string; message: string } {
    const match = rawMessage.match(/^!(\S+)\s+([\s\S]*)$/);
    if (match) {
        const candidateId = match[1].toLowerCase();

        // Check agent IDs
        if (agents[candidateId]) {
            return { agentId: candidateId, message: match[2] };
        }

        // Match by agent name (case-insensitive)
        for (const [id, config] of Object.entries(agents)) {
            if (config.name.toLowerCase() === candidateId) {
                return { agentId: id, message: match[2] };
            }
        }
    }
    return { agentId: 'default', message: rawMessage };
}
