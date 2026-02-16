import https from 'https';
import { URL } from 'url';
import { loadCredentials, IDFCredentials } from '../utils/credentials';
import { cacheGet, cacheSet } from '../utils/cache';

let _creds: IDFCredentials | null = null;

function getCreds(): IDFCredentials {
    if (!_creds) _creds = loadCredentials();
    return _creds;
}

export async function apiRequest<T>(
    endpoint: string,
    params: Record<string, string> = {},
    cacheKey?: string,
    cacheTtl?: number,
): Promise<T> {
    if (cacheKey) {
        const cached = cacheGet<T>(cacheKey);
        if (cached !== undefined) return cached;
    }

    const creds = getCreds();
    const url = new URL(endpoint, creds.baseUrl);
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
    }

    const data = await new Promise<T>((resolve, reject) => {
        const req = https.get(
            url.toString(),
            { headers: { apiKey: creds.apiKey } },
            (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode === 401) {
                        reject(new Error(
                            'API authentication failed. Check your API key in credentials.json\n' +
                            'Get a key at: https://prim.iledefrance-mobilites.fr/'
                        ));
                        return;
                    }
                    if (res.statusCode === 429) {
                        reject(new Error('Rate limit exceeded. Try again later.'));
                        return;
                    }
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`API error ${res.statusCode}: ${body.slice(0, 200)}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        reject(new Error(`Invalid JSON response: ${body.slice(0, 200)}`));
                    }
                });
            },
        );
        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('API request timed out (15s)'));
        });
    });

    if (cacheKey && cacheTtl) {
        cacheSet(cacheKey, data, cacheTtl);
    }
    return data;
}
