import { describe, it, expect } from 'vitest';
import { parseAgentRouting, findTeamForAgent, isTeammate, extractTeammateMentions, extractAgentPrefix } from '../lib/routing';
import type { AgentConfig, TeamConfig } from '../lib/types';

const agents: Record<string, AgentConfig> = {
    coder: { name: 'Coder', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/coder' },
    reviewer: { name: 'Reviewer', provider: 'anthropic', model: 'opus', working_directory: '/tmp/reviewer' },
    writer: { name: 'Writer', provider: 'anthropic', model: 'sonnet', working_directory: '/tmp/writer' },
};

const teams: Record<string, TeamConfig> = {
    devteam: { name: 'DevTeam', agents: ['coder', 'reviewer'], leader_agent: 'coder' },
};

describe('parseAgentRouting', () => {
    it('routes !agent_id messages to the correct agent', () => {
        const result = parseAgentRouting('!coder fix the bug', agents, teams);
        expect(result.agentId).toBe('coder');
        expect(result.message).toBe('fix the bug');
    });

    it('routes !team_id messages to the team leader', () => {
        const result = parseAgentRouting('!devteam review this PR', agents, teams);
        expect(result.agentId).toBe('coder');
        expect(result.message).toBe('review this PR');
        expect(result.isTeam).toBe(true);
    });

    it('defaults to "default" agent when no ! prefix', () => {
        const result = parseAgentRouting('hello world', agents, teams);
        expect(result.agentId).toBe('default');
        expect(result.message).toBe('hello world');
    });

    it('defaults to "default" agent when !mention is unknown', () => {
        const result = parseAgentRouting('!unknown do something', agents, teams);
        expect(result.agentId).toBe('default');
        expect(result.message).toBe('!unknown do something');
    });

    it('matches agent by name (case-insensitive)', () => {
        const result = parseAgentRouting('!Coder fix the bug', agents, teams);
        expect(result.agentId).toBe('coder');
    });

    it('returns error for multiple agents across teams', () => {
        const result = parseAgentRouting('!coder and !writer collaborate', agents, teams);
        expect(result.agentId).toBe('error');
    });

    it('does not error for multiple agents in the same team', () => {
        const result = parseAgentRouting('!coder and !reviewer collaborate', agents, teams);
        // Both are in devteam, so no error
        expect(result.agentId).not.toBe('error');
    });
});

describe('findTeamForAgent', () => {
    it('finds team containing agent', () => {
        const result = findTeamForAgent('coder', teams);
        expect(result).not.toBeNull();
        expect(result!.teamId).toBe('devteam');
    });

    it('returns null for agent not in any team', () => {
        const result = findTeamForAgent('writer', teams);
        expect(result).toBeNull();
    });
});

describe('isTeammate', () => {
    it('returns true for valid teammate', () => {
        expect(isTeammate('reviewer', 'coder', 'devteam', teams, agents)).toBe(true);
    });

    it('returns false for self-reference', () => {
        expect(isTeammate('coder', 'coder', 'devteam', teams, agents)).toBe(false);
    });

    it('returns false for agent not in team', () => {
        expect(isTeammate('writer', 'coder', 'devteam', teams, agents)).toBe(false);
    });
});

describe('extractTeammateMentions', () => {
    it('extracts tag format mentions', () => {
        const response = '[@reviewer: please review this code]';
        const results = extractTeammateMentions(response, 'coder', 'devteam', teams, agents);
        expect(results).toHaveLength(1);
        expect(results[0].teammateId).toBe('reviewer');
        expect(results[0].message).toBe('please review this code');
    });

    it('extracts bare @mention as fallback', () => {
        const response = 'Hey @reviewer can you check this?';
        const results = extractTeammateMentions(response, 'coder', 'devteam', teams, agents);
        expect(results).toHaveLength(1);
        expect(results[0].teammateId).toBe('reviewer');
    });

    it('returns empty for no teammate mentions', () => {
        const response = 'All done, no help needed';
        const results = extractTeammateMentions(response, 'coder', 'devteam', teams, agents);
        expect(results).toHaveLength(0);
    });

    it('ignores mentions of agents not in the team', () => {
        const response = 'Hey @writer can you help?';
        const results = extractTeammateMentions(response, 'coder', 'devteam', teams, agents);
        expect(results).toHaveLength(0);
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
