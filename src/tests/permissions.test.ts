import { describe, it, expect } from 'vitest';
import { resolvePermissions, getAgents, getDefaultAgentFromModels } from '../lib/config';
import type { Settings } from '../lib/types';

describe('resolvePermissions', () => {
    it('returns global permissions when agent has no overrides', () => {
        const settings: Settings = {
            permissions: {
                allowedTools: ['Read', 'Grep', 'Glob'],
                deniedTools: [],
            },
            agents: {
                coder: {
                    name: 'Coder',
                    provider: 'anthropic',
                    model: 'sonnet',
                    working_directory: '/tmp/coder',
                },
            },
        };

        const result = resolvePermissions(settings, 'coder');
        expect(result.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
        expect(result.deniedTools).toEqual([]);
    });

    it('uses agent-level allowedTools when present (replaces global)', () => {
        const settings: Settings = {
            permissions: {
                allowedTools: ['Read', 'Grep'],
                deniedTools: [],
            },
            agents: {
                coder: {
                    name: 'Coder',
                    provider: 'anthropic',
                    model: 'sonnet',
                    working_directory: '/tmp/coder',
                    permissions: {
                        allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'],
                    },
                },
            },
        };

        const result = resolvePermissions(settings, 'coder');
        expect(result.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash']);
    });

    it('filters deniedTools from allowedTools', () => {
        const settings: Settings = {
            permissions: {
                allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'],
                deniedTools: ['Bash'],
            },
            agents: {
                reader: {
                    name: 'Reader',
                    provider: 'anthropic',
                    model: 'sonnet',
                    working_directory: '/tmp/reader',
                },
            },
        };

        const result = resolvePermissions(settings, 'reader');
        expect(result.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Write', 'Edit']);
        expect(result.deniedTools).toEqual(['Bash']);
    });

    it('agent-level deniedTools overrides global deniedTools', () => {
        const settings: Settings = {
            permissions: {
                allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'],
                deniedTools: ['Bash'],
            },
            agents: {
                coder: {
                    name: 'Coder',
                    provider: 'anthropic',
                    model: 'sonnet',
                    working_directory: '/tmp/coder',
                    permissions: {
                        deniedTools: [],  // agent explicitly allows everything
                    },
                },
            },
        };

        const result = resolvePermissions(settings, 'coder');
        // Agent deniedTools=[] replaces global deniedTools=['Bash']
        expect(result.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash']);
        expect(result.deniedTools).toEqual([]);
    });

    it('returns empty allowedTools when no permissions configured', () => {
        const settings: Settings = {
            agents: {
                coder: {
                    name: 'Coder',
                    provider: 'anthropic',
                    model: 'sonnet',
                    working_directory: '/tmp/coder',
                },
            },
        };

        const result = resolvePermissions(settings, 'coder');
        expect(result.allowedTools).toEqual([]);
        expect(result.deniedTools).toEqual([]);
    });

    it('falls back to default agent when agentId not found', () => {
        const settings: Settings = {
            permissions: {
                allowedTools: ['Read', 'Grep'],
                deniedTools: [],
            },
        };

        // 'nonexistent' won't match any agent, so agent perms are {}
        const result = resolvePermissions(settings, 'nonexistent');
        expect(result.allowedTools).toEqual(['Read', 'Grep']);
    });

    it('handles agent-level allowedTools with global deniedTools', () => {
        const settings: Settings = {
            permissions: {
                allowedTools: ['Read'],
                deniedTools: ['Write'],
            },
            agents: {
                writer: {
                    name: 'Writer',
                    provider: 'anthropic',
                    model: 'sonnet',
                    working_directory: '/tmp/writer',
                    permissions: {
                        allowedTools: ['Read', 'Write', 'Edit'],
                        // no deniedTools — falls through to global
                    },
                },
            },
        };

        const result = resolvePermissions(settings, 'writer');
        // Agent allowedTools replaces global, global deniedTools applies (Write filtered out)
        expect(result.allowedTools).toEqual(['Read', 'Edit']);
        // deniedTools falls through to global since agent has none
        expect(result.deniedTools).toEqual(['Write']);
    });
});

describe('getAgents', () => {
    it('returns configured agents when present', () => {
        const settings: Settings = {
            agents: {
                coder: {
                    name: 'Coder',
                    provider: 'anthropic',
                    model: 'sonnet',
                    working_directory: '/tmp/coder',
                },
            },
        };

        const agents = getAgents(settings);
        expect(Object.keys(agents)).toEqual(['coder']);
        expect(agents.coder.name).toBe('Coder');
    });

    it('falls back to default agent when no agents configured', () => {
        const settings: Settings = {
            models: {
                provider: 'anthropic',
                anthropic: { model: 'opus' },
            },
        };

        const agents = getAgents(settings);
        expect(Object.keys(agents)).toEqual(['default']);
        expect(agents.default.provider).toBe('anthropic');
        expect(agents.default.model).toBe('opus');
    });

    it('falls back to default agent when agents is empty', () => {
        const settings: Settings = {
            agents: {},
        };

        const agents = getAgents(settings);
        expect(Object.keys(agents)).toEqual(['default']);
    });
});

describe('getDefaultAgentFromModels', () => {
    it('creates anthropic agent by default', () => {
        const settings: Settings = {};
        const agent = getDefaultAgentFromModels(settings);
        expect(agent.provider).toBe('anthropic');
        expect(agent.model).toBe('sonnet');
    });

    it('creates openai agent when provider is openai', () => {
        const settings: Settings = {
            models: {
                provider: 'openai',
                openai: { model: 'gpt-5.2' },
            },
        };
        const agent = getDefaultAgentFromModels(settings);
        expect(agent.provider).toBe('openai');
        expect(agent.model).toBe('gpt-5.2');
    });
});
