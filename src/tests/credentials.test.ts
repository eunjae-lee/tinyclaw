import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { getCredentials, CREDENTIALS_FILE, SETTINGS_FILE } from '../lib/config';

vi.mock('fs');

const mockedFs = vi.mocked(fs);

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('getCredentials', () => {
    it('reads from credentials.json when it exists', () => {
        const credentials = {
            channels: { discord: { bot_token: 'secret-token' } },
        };
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify(credentials));

        const result = getCredentials();

        expect(mockedFs.existsSync).toHaveBeenCalledWith(CREDENTIALS_FILE);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(CREDENTIALS_FILE, 'utf8');
        expect(result).toEqual(credentials);
    });

    it('falls back to settings.json bot_token when credentials.json missing', () => {
        const settings = {
            channels: {
                enabled: ['discord'],
                discord: { bot_token: 'legacy-token', allowed_channels: ['123'] },
            },
            admin_user_id: '456',
        };
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify(settings));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = getCredentials();

        // Only bot_token should be extracted, not allowed_channels or admin_user_id
        expect(result).toEqual({
            channels: { discord: { bot_token: 'legacy-token' } },
        });
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('bot_token found in settings.json')
        );
    });

    it('returns empty when credentials.json missing and settings.json has no bot_token', () => {
        const settings = {
            channels: { enabled: ['discord'] },
            admin_user_id: '456',
        };
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify(settings));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = getCredentials();

        expect(result).toEqual({});
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns empty when neither file exists', () => {
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

        const result = getCredentials();
        expect(result).toEqual({});
    });

    it('returns empty when credentials.json has invalid JSON', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue('not json');

        const result = getCredentials();
        expect(result).toEqual({});
    });
});
