import { getCredentials } from '../../lib/config';

export interface IDFCredentials {
    apiKey: string;
    baseUrl: string;
}

export function loadCredentials(): IDFCredentials {
    const creds = getCredentials();
    const idfCreds = (creds as any).features?.idf_mobilites;

    if (!idfCreds?.api_key) {
        throw new Error(
            'IDF Mobilites API key not found.\n' +
            'Add it to credentials.json under features.idf_mobilites.api_key\n' +
            'Get a key at: https://prim.iledefrance-mobilites.fr/'
        );
    }

    return {
        apiKey: idfCreds.api_key,
        baseUrl: idfCreds.base_url || 'https://prim.iledefrance-mobilites.fr/marketplace',
    };
}
