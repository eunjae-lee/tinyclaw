import { describe, it, expect } from 'vitest';
import { resolveClaudeModel, resolveCodexModel } from '../lib/config';

describe('resolveClaudeModel', () => {
    it('resolves "sonnet" to full model ID', () => {
        expect(resolveClaudeModel('sonnet')).toBe('claude-sonnet-4-5');
    });

    it('resolves "opus" to full model ID', () => {
        expect(resolveClaudeModel('opus')).toBe('claude-opus-4-6');
    });

    it('passes through full model IDs unchanged', () => {
        expect(resolveClaudeModel('claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
        expect(resolveClaudeModel('claude-opus-4-6')).toBe('claude-opus-4-6');
    });

    it('passes through unknown model names unchanged', () => {
        expect(resolveClaudeModel('custom-model')).toBe('custom-model');
    });

    it('returns empty string for empty input', () => {
        expect(resolveClaudeModel('')).toBe('');
    });
});

describe('resolveCodexModel', () => {
    it('resolves known codex models', () => {
        expect(resolveCodexModel('gpt-5.2')).toBe('gpt-5.2');
        expect(resolveCodexModel('gpt-5.3-codex')).toBe('gpt-5.3-codex');
    });

    it('passes through unknown model names unchanged', () => {
        expect(resolveCodexModel('custom-model')).toBe('custom-model');
    });

    it('returns empty string for empty input', () => {
        expect(resolveCodexModel('')).toBe('');
    });
});
