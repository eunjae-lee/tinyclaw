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
    // Simulates the logic in discord-client.ts that builds QueueData
    function buildQueueAgent(
        channelType: 'thread' | 'channel' | 'dm',
        channelId: string,
        botOwnedThreads: Map<string, string | undefined>,
    ): string | undefined {
        const isThread = channelType === 'thread';
        return isThread ? botOwnedThreads.get(channelId) : undefined;
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

    it('returns undefined for non-thread channel messages', () => {
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
});
