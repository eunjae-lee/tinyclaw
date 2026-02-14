import { describe, it, expect } from 'vitest';
import { parseAgentRouting, extractAgentPrefix } from '../lib/routing';
import type { AgentConfig } from '../lib/types';

const agents: Record<string, AgentConfig> = {
    coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
    reviewer: { name: 'Reviewer', provider: 'anthropic', model: 'opus', working_directory: '/tmp/reviewer' },
    writer: { name: 'Writer', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/writer' },
};

describe('parseAgentRouting', () => {
    it('routes !agent_id messages to the correct agent', () => {
        const result = parseAgentRouting('!coder fix the bug', agents);
        expect(result.agentId).toBe('coder');
        expect(result.message).toBe('fix the bug');
    });

    it('defaults to "default" agent when no ! prefix', () => {
        const result = parseAgentRouting('hello world', agents);
        expect(result.agentId).toBe('default');
        expect(result.message).toBe('hello world');
    });

    it('defaults to "default" agent when !mention is unknown', () => {
        const result = parseAgentRouting('!unknown do something', agents);
        expect(result.agentId).toBe('default');
        expect(result.message).toBe('!unknown do something');
    });

    it('matches agent by name (case-insensitive)', () => {
        const result = parseAgentRouting('!Coder fix the bug', agents);
        expect(result.agentId).toBe('coder');
    });
});

describe('extractAgentPrefix', () => {
    it('extracts agent id from !agent prefix', () => {
        expect(extractAgentPrefix('!tc where is the bug')).toBe('tc');
    });

    it('lowercases the agent id', () => {
        expect(extractAgentPrefix('!MyAgent do something')).toBe('myagent');
    });

    it('returns undefined for messages without ! prefix', () => {
        expect(extractAgentPrefix('hello world')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
        expect(extractAgentPrefix('')).toBeUndefined();
    });

    it('returns undefined for ! with no space after agent id', () => {
        expect(extractAgentPrefix('!agentonly')).toBeUndefined();
    });

    it('handles multi-word messages after prefix', () => {
        expect(extractAgentPrefix('!coder fix the bug in auth module')).toBe('coder');
    });

    it('returns undefined for messages starting with other special chars', () => {
        expect(extractAgentPrefix('/agent do something')).toBeUndefined();
        expect(extractAgentPrefix('@agent do something')).toBeUndefined();
    });

    it('returns undefined for ! followed by space only', () => {
        expect(extractAgentPrefix('! something')).toBeUndefined();
    });
});
