import { describe, it, expect } from 'vitest';
import { preprocessJsonl } from '../memory/ingest';

describe('preprocessJsonl', () => {
    it('extracts user and assistant messages', () => {
        const lines = [
            JSON.stringify({ message: { role: 'user', content: 'Fix the bug' } }),
            JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'I will fix the bug.' }] } }),
        ];
        const result = preprocessJsonl(lines);
        expect(result).toContain('User: Fix the bug');
        expect(result).toContain('Assistant: I will fix the bug.');
    });

    it('skips tool_use content blocks', () => {
        const lines = [
            JSON.stringify({
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Let me read that file.' },
                        { type: 'tool_use', id: 'xyz', name: 'Read', input: { file_path: '/foo' } },
                    ],
                },
            }),
        ];
        const result = preprocessJsonl(lines);
        expect(result).toContain('Let me read that file.');
        expect(result).not.toContain('tool_use');
        expect(result).not.toContain('/foo');
    });

    it('truncates long messages to 500 characters', () => {
        const longText = 'A'.repeat(600);
        const lines = [
            JSON.stringify({ message: { role: 'user', content: longText } }),
        ];
        const result = preprocessJsonl(lines);
        expect(result.length).toBeLessThan(600);
        expect(result).toContain('...');
    });

    it('handles malformed JSON lines gracefully', () => {
        const lines = [
            'not json at all',
            JSON.stringify({ message: { role: 'user', content: 'Valid message' } }),
            '{ broken json',
        ];
        const result = preprocessJsonl(lines);
        expect(result).toContain('Valid message');
    });

    it('returns empty string for empty input', () => {
        expect(preprocessJsonl([])).toBe('');
    });

    it('handles user messages with string content', () => {
        const lines = [
            JSON.stringify({ message: { role: 'user', content: 'Hello there' } }),
        ];
        const result = preprocessJsonl(lines);
        expect(result).toBe('User: Hello there');
    });

    it('handles assistant messages with array content', () => {
        const lines = [
            JSON.stringify({
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Part one.' },
                        { type: 'text', text: 'Part two.' },
                    ],
                },
            }),
        ];
        const result = preprocessJsonl(lines);
        expect(result).toContain('Part one.');
        expect(result).toContain('Part two.');
    });

    it('skips messages with empty text content', () => {
        const lines = [
            JSON.stringify({ message: { role: 'user', content: '' } }),
            JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: '' }] } }),
            JSON.stringify({ message: { role: 'user', content: 'Real message' } }),
        ];
        const result = preprocessJsonl(lines);
        expect(result).toBe('User: Real message');
    });

    it('skips lines without message field', () => {
        const lines = [
            JSON.stringify({ type: 'system', data: 'something' }),
            JSON.stringify({ message: { role: 'user', content: 'Keep this' } }),
        ];
        const result = preprocessJsonl(lines);
        expect(result).toBe('User: Keep this');
    });

    it('skips non-user/assistant roles', () => {
        const lines = [
            JSON.stringify({ message: { role: 'system', content: 'System message' } }),
            JSON.stringify({ message: { role: 'user', content: 'User message' } }),
        ];
        const result = preprocessJsonl(lines);
        expect(result).toBe('User: User message');
    });
});
