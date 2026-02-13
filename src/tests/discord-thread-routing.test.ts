import { describe, it, expect, beforeEach } from 'vitest';
import { extractAgentPrefix } from '../lib/routing';

/**
 * Tests for the thread-based agent routing logic used by discord-client.ts.
 *
 * The discord client uses a Map<string, string | undefined> (botOwnedThreads)
 * to track which agent started each thread. These tests verify the map-based
 * routing logic and queue data construction patterns without requiring a live
 * Discord connection.
 */

describe('botOwnedThreads map behavior', () => {
    let botOwnedThreads: Map<string, string | undefined>;

    beforeEach(() => {
        botOwnedThreads = new Map();
    });

    it('stores agent from starter message with !prefix', () => {
        const starterContent = '!tc where is the login page?';
        const agent = extractAgentPrefix(starterContent);
        botOwnedThreads.set('thread-1', agent);

        expect(botOwnedThreads.get('thread-1')).toBe('tc');
    });

    it('stores undefined when starter message has no !prefix', () => {
        const starterContent = 'just a normal message';
        const agent = extractAgentPrefix(starterContent);
        botOwnedThreads.set('thread-2', agent);

        expect(botOwnedThreads.has('thread-2')).toBe(true);
        expect(botOwnedThreads.get('thread-2')).toBeUndefined();
    });

    it('preserves agent across multiple lookups (follow-up messages)', () => {
        botOwnedThreads.set('thread-1', 'tc');

        // Simulate 3 follow-up messages in the same thread
        for (let i = 0; i < 3; i++) {
            expect(botOwnedThreads.get('thread-1')).toBe('tc');
        }
    });

    it('does not overwrite agent on re-track', () => {
        botOwnedThreads.set('thread-1', 'coder');

        // Simulate the "auto-track so future messages don't re-fetch" guard
        if (!botOwnedThreads.has('thread-1')) {
            botOwnedThreads.set('thread-1', undefined);
        }

        expect(botOwnedThreads.get('thread-1')).toBe('coder');
    });

    it('cleans up on thread delete', () => {
        botOwnedThreads.set('thread-1', 'tc');
        botOwnedThreads.delete('thread-1');

        expect(botOwnedThreads.has('thread-1')).toBe(false);
    });

    it('tracks multiple threads with different agents', () => {
        botOwnedThreads.set('thread-1', 'tc');
        botOwnedThreads.set('thread-2', 'coder');
        botOwnedThreads.set('thread-3', undefined);

        expect(botOwnedThreads.get('thread-1')).toBe('tc');
        expect(botOwnedThreads.get('thread-2')).toBe('coder');
        expect(botOwnedThreads.get('thread-3')).toBeUndefined();
    });
});

describe('queue data agent field construction', () => {
    // Simulates the updated logic in discord-client.ts that builds QueueData
    // Priority: threadAgent > channelDefault > undefined
    function buildQueueAgent(
        channelType: 'thread' | 'channel' | 'dm',
        channelId: string,
        botOwnedThreads: Map<string, string | undefined>,
        defaultAgents: Map<string, string> = new Map(),
        parentChannelId?: string,
        isGuild: boolean = true,
    ): string | undefined {
        const isThread = channelType === 'thread';
        const threadAgent = isThread ? botOwnedThreads.get(channelId) : undefined;
        const channelDefault = isGuild
            ? defaultAgents.get(isThread ? parentChannelId! : channelId)
            : undefined;
        return threadAgent ?? channelDefault;
    }

    it('includes agent for thread messages with known agent', () => {
        const threads = new Map<string, string | undefined>();
        threads.set('thread-1', 'tc');

        expect(buildQueueAgent('thread', 'thread-1', threads)).toBe('tc');
    });

    it('returns undefined for thread messages with no agent prefix', () => {
        const threads = new Map<string, string | undefined>();
        threads.set('thread-2', undefined);

        expect(buildQueueAgent('thread', 'thread-2', threads)).toBeUndefined();
    });

    it('returns undefined for non-thread channel messages without default', () => {
        const threads = new Map<string, string | undefined>();
        threads.set('thread-1', 'tc');

        expect(buildQueueAgent('channel', 'channel-1', threads)).toBeUndefined();
    });

    it('returns undefined for DM messages', () => {
        const threads = new Map<string, string | undefined>();

        expect(buildQueueAgent('dm', 'dm-1', threads)).toBeUndefined();
    });

    it('returns undefined for unknown thread', () => {
        const threads = new Map<string, string | undefined>();

        expect(buildQueueAgent('thread', 'unknown-thread', threads)).toBeUndefined();
    });

    it('uses channel default agent for channel messages', () => {
        const threads = new Map<string, string | undefined>();
        const defaults = new Map<string, string>();
        defaults.set('channel-1', 'tc');

        expect(buildQueueAgent('channel', 'channel-1', threads, defaults)).toBe('tc');
    });

    it('uses parent channel default agent for thread messages', () => {
        const threads = new Map<string, string | undefined>();
        threads.set('thread-1', undefined); // thread tracked but no explicit agent
        const defaults = new Map<string, string>();
        defaults.set('parent-channel', 'tc');

        expect(buildQueueAgent('thread', 'thread-1', threads, defaults, 'parent-channel')).toBe('tc');
    });

    it('thread agent takes priority over channel default', () => {
        const threads = new Map<string, string | undefined>();
        threads.set('thread-1', 'coder');
        const defaults = new Map<string, string>();
        defaults.set('parent-channel', 'tc');

        expect(buildQueueAgent('thread', 'thread-1', threads, defaults, 'parent-channel')).toBe('coder');
    });

    it('does not apply channel default for DMs', () => {
        const threads = new Map<string, string | undefined>();
        const defaults = new Map<string, string>();
        defaults.set('dm-1', 'tc');

        expect(buildQueueAgent('dm', 'dm-1', threads, defaults, undefined, false)).toBeUndefined();
    });

    it('returns undefined when channel has no default and no thread agent', () => {
        const threads = new Map<string, string | undefined>();
        const defaults = new Map<string, string>();
        defaults.set('other-channel', 'tc');

        expect(buildQueueAgent('channel', 'channel-1', threads, defaults)).toBeUndefined();
    });
});

describe('thread creation stores response agent', () => {
    it('stores agent from response data when creating thread', () => {
        const botOwnedThreads = new Map<string, string | undefined>();

        // Simulate: outgoing queue handler creates a thread, stores responseData.agent
        const responseAgent = 'coder';
        const threadId = 'new-thread-1';
        botOwnedThreads.set(threadId, responseAgent);

        expect(botOwnedThreads.get(threadId)).toBe('coder');
    });

    it('stores undefined when response has no agent', () => {
        const botOwnedThreads = new Map<string, string | undefined>();

        const responseAgent = undefined;
        const threadId = 'new-thread-2';
        botOwnedThreads.set(threadId, responseAgent);

        expect(botOwnedThreads.has(threadId)).toBe(true);
        expect(botOwnedThreads.get(threadId)).toBeUndefined();
    });

    it('falls back to parent channel default when response has no agent', () => {
        const botOwnedThreads = new Map<string, string | undefined>();
        const defaultAgents = new Map<string, string>();
        defaultAgents.set('parent-channel', 'tc');

        // Simulate: responseData.agent is undefined, fall back to parent channel default
        const responseAgent = undefined;
        const parentDefault = defaultAgents.get('parent-channel');
        const threadId = 'new-thread-3';
        botOwnedThreads.set(threadId, responseAgent ?? parentDefault);

        expect(botOwnedThreads.get(threadId)).toBe('tc');
    });

    it('response agent takes priority over parent channel default', () => {
        const botOwnedThreads = new Map<string, string | undefined>();
        const defaultAgents = new Map<string, string>();
        defaultAgents.set('parent-channel', 'tc');

        const responseAgent = 'coder';
        const parentDefault = defaultAgents.get('parent-channel');
        const threadId = 'new-thread-4';
        botOwnedThreads.set(threadId, responseAgent ?? parentDefault);

        expect(botOwnedThreads.get(threadId)).toBe('coder');
    });
});

describe('getAllowedChannels normalization', () => {
    // Simulates the normalization logic in getAllowedChannels
    function normalizeAllowedChannels(
        raw: Array<string | { channelId: string; defaultAgent: string }>,
    ): { channelIds: string[]; defaultAgents: Map<string, string> } {
        const channelIds: string[] = [];
        const defaultAgents = new Map<string, string>();
        for (const entry of raw) {
            if (typeof entry === 'string') {
                channelIds.push(entry);
            } else {
                channelIds.push(entry.channelId);
                defaultAgents.set(entry.channelId, entry.defaultAgent);
            }
        }
        return { channelIds, defaultAgents };
    }

    it('handles plain string channel IDs (backward compatible)', () => {
        const result = normalizeAllowedChannels(['123', '456']);

        expect(result.channelIds).toEqual(['123', '456']);
        expect(result.defaultAgents.size).toBe(0);
    });

    it('handles object entries with defaultAgent', () => {
        const result = normalizeAllowedChannels([
            { channelId: '123', defaultAgent: 'tc' },
        ]);

        expect(result.channelIds).toEqual(['123']);
        expect(result.defaultAgents.get('123')).toBe('tc');
    });

    it('handles mixed array of strings and objects', () => {
        const result = normalizeAllowedChannels([
            '123',
            { channelId: '456', defaultAgent: 'coder' },
            '789',
        ]);

        expect(result.channelIds).toEqual(['123', '456', '789']);
        expect(result.defaultAgents.size).toBe(1);
        expect(result.defaultAgents.get('456')).toBe('coder');
        expect(result.defaultAgents.has('123')).toBe(false);
    });

    it('handles empty array', () => {
        const result = normalizeAllowedChannels([]);

        expect(result.channelIds).toEqual([]);
        expect(result.defaultAgents.size).toBe(0);
    });
});
