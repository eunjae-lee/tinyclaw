import { apiRequest } from './client';
import { CACHE_TTL } from '../utils/cache';

export interface Place {
    id: string;
    name: string;
    label: string;
    type: string; // 'stop_area' | 'stop_point' | 'address' | 'poi' | 'administrative_region'
    coord: { lat: string; lon: string } | null;
    stopArea?: { id: string; name: string };
}

interface NavitiaPlacesResponse {
    places: Array<{
        id: string;
        name: string;
        embedded_type: string;
        quality: number;
        stop_area?: {
            id: string;
            name: string;
            label: string;
            coord: { lat: string; lon: string };
        };
        stop_point?: {
            id: string;
            name: string;
            label: string;
            coord: { lat: string; lon: string };
            stop_area?: { id: string; name: string };
        };
        address?: {
            id: string;
            name: string;
            label: string;
            coord: { lat: string; lon: string };
        };
        poi?: {
            id: string;
            name: string;
            label: string;
            coord: { lat: string; lon: string };
        };
        administrative_region?: {
            id: string;
            name: string;
            label: string;
            coord: { lat: string; lon: string };
        };
    }>;
}

export async function searchPlaces(query: string, type?: string): Promise<Place[]> {
    const params: Record<string, string> = { q: query };
    if (type) params.type = `[${type}]`;

    const cacheKey = `places:${query}:${type || ''}`;
    const data = await apiRequest<NavitiaPlacesResponse>(
        'v2/navitia/coverage/fr-idf/places',
        params,
        cacheKey,
        CACHE_TTL.places,
    );

    if (!data.places) return [];

    return data.places.map((p) => {
        const embedded = p[p.embedded_type as keyof typeof p] as any;
        return {
            id: p.id,
            name: p.name,
            label: embedded?.label || p.name,
            type: p.embedded_type,
            coord: embedded?.coord || null,
            stopArea: embedded?.stop_area ? { id: embedded.stop_area.id, name: embedded.stop_area.name } : undefined,
        };
    });
}

/**
 * Resolve a place name to a navitia ID (for journey planning).
 * Returns the first stop_area or stop_point match.
 */
export async function resolvePlace(query: string): Promise<{ id: string; name: string } | null> {
    const places = await searchPlaces(query);
    const stop = places.find((p) => p.type === 'stop_area' || p.type === 'stop_point');
    if (stop) return { id: stop.id, name: stop.name };
    if (places.length > 0) return { id: places[0].id, name: places[0].name };
    return null;
}

export interface NearbyStop {
    id: string;
    name: string;
    distance: number;
    coord: { lat: string; lon: string };
    type: string;
}

interface NavitiaPlacesNearbyResponse {
    places_nearby: Array<{
        id: string;
        name: string;
        distance: string;
        embedded_type: string;
        stop_area?: { id: string; name: string; coord: { lat: string; lon: string } };
        stop_point?: { id: string; name: string; coord: { lat: string; lon: string } };
    }>;
}

export async function findNearbyStops(lat: string, lon: string, radius?: number): Promise<NearbyStop[]> {
    const params: Record<string, string> = {
        'type[]': 'stop_area',
    };
    if (radius) params.distance = String(radius);

    const endpoint = `v2/navitia/coverage/fr-idf/coords/${lon};${lat}/places_nearby`;
    const cacheKey = `nearby:${lat}:${lon}:${radius || ''}`;
    const data = await apiRequest<NavitiaPlacesNearbyResponse>(
        endpoint,
        params,
        cacheKey,
        CACHE_TTL.places,
    );

    if (!data.places_nearby) return [];

    return data.places_nearby.map((p) => {
        const embedded = (p.stop_area || p.stop_point)!;
        return {
            id: p.id,
            name: p.name,
            distance: parseInt(p.distance, 10),
            coord: embedded.coord,
            type: p.embedded_type,
        };
    });
}
