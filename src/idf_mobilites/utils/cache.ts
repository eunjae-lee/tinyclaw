interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export const CACHE_TTL = {
    places: 24 * 60 * 60 * 1000,   // 24 hours
    departures: 30 * 1000,          // 30 seconds
    journeys: 5 * 60 * 1000,        // 5 minutes
    traffic: 2 * 60 * 1000,         // 2 minutes
};

export function cacheGet<T>(key: string): T | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
    }
    return entry.data as T;
}

export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
    store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function cacheClear(): number {
    const count = store.size;
    store.clear();
    return count;
}

export function cacheStats(): { entries: number; expired: number } {
    let expired = 0;
    const now = Date.now();
    for (const entry of store.values()) {
        if (now > entry.expiresAt) expired++;
    }
    return { entries: store.size, expired };
}
