import { apiRequest } from './client';
import { CACHE_TTL } from '../utils/cache';
import { resolvePlace } from './places';
import { toApiDatetime } from '../utils/time';

export interface JourneySection {
    type: string; // 'public_transport' | 'street_network' | 'transfer' | 'waiting'
    mode?: string; // 'walking' | 'bike' | etc.
    from: { name: string; id?: string };
    to: { name: string; id?: string };
    departureDateTime: string;
    arrivalDateTime: string;
    duration: number;
    displayInfo?: {
        network: string;
        commercialMode: string;
        direction: string;
        label: string;
        color: string;
        code: string;
    };
    stopCount?: number;
    geojson?: unknown;
}

export interface Journey {
    departureDateTime: string;
    arrivalDateTime: string;
    duration: number;
    nbTransfers: number;
    walkingDuration: number;
    walkingDistance: number;
    status: string;
    sections: JourneySection[];
}

export interface JourneyOptions {
    departAt?: Date;
    arriveBy?: Date;
    maxTransfers?: number;
    modes?: string[];
    count?: number;
}

interface NavitiaJourneyResponse {
    journeys: Array<{
        departure_date_time: string;
        arrival_date_time: string;
        duration: number;
        nb_transfers: number;
        status: string;
        durations: { walking: number; total: number };
        distances: { walking: number };
        sections: Array<{
            type: string;
            mode?: string;
            from: { name: string; id: string };
            to: { name: string; id: string };
            departure_date_time: string;
            arrival_date_time: string;
            duration: number;
            display_informations?: {
                network: string;
                commercial_mode: string;
                direction: string;
                label: string;
                color: string;
                code: string;
            };
            stop_date_times?: unknown[];
            geojson?: unknown;
        }>;
    }>;
    error?: { id: string; message: string };
}

function parseNavitiaDateTime(dt: string): string {
    // Navitia format: "20240215T143500" -> ISO
    const y = dt.slice(0, 4);
    const m = dt.slice(4, 6);
    const d = dt.slice(6, 8);
    const h = dt.slice(9, 11);
    const min = dt.slice(11, 13);
    const s = dt.slice(13, 15);
    return `${y}-${m}-${d}T${h}:${min}:${s}`;
}

export async function planJourney(
    fromQuery: string,
    toQuery: string,
    options: JourneyOptions = {},
): Promise<Journey[]> {
    // Resolve place names to IDs
    const [fromPlace, toPlace] = await Promise.all([
        resolvePlace(fromQuery),
        resolvePlace(toQuery),
    ]);

    if (!fromPlace) throw new Error(`Could not find place: "${fromQuery}"`);
    if (!toPlace) throw new Error(`Could not find place: "${toQuery}"`);

    const params: Record<string, string> = {
        from: fromPlace.id,
        to: toPlace.id,
    };

    if (options.departAt) {
        params.datetime = toApiDatetime(options.departAt);
        params.datetime_represents = 'departure';
    } else if (options.arriveBy) {
        params.datetime = toApiDatetime(options.arriveBy);
        params.datetime_represents = 'arrival';
    }

    if (options.maxTransfers !== undefined) {
        params.max_nb_transfers = String(options.maxTransfers);
    }
    if (options.count) {
        params.count = String(options.count);
    }
    if (options.modes?.length) {
        params['allowed_id[]'] = options.modes.map((m) => `commercial_mode:${m}`).join(',');
    }

    const cacheKey = `journey:${fromPlace.id}:${toPlace.id}:${JSON.stringify(options)}`;
    const data = await apiRequest<NavitiaJourneyResponse>(
        '/v2/navitia/coverage/fr-idf/journeys',
        params,
        cacheKey,
        CACHE_TTL.journeys,
    );

    if (data.error) {
        throw new Error(`Journey planning failed: ${data.error.message}`);
    }

    if (!data.journeys?.length) {
        throw new Error(`No routes found from "${fromQuery}" to "${toQuery}"`);
    }

    return data.journeys.map((j) => ({
        departureDateTime: parseNavitiaDateTime(j.departure_date_time),
        arrivalDateTime: parseNavitiaDateTime(j.arrival_date_time),
        duration: j.duration,
        nbTransfers: j.nb_transfers,
        walkingDuration: j.durations?.walking || 0,
        walkingDistance: j.distances?.walking || 0,
        status: j.status,
        sections: j.sections.map((s) => ({
            type: s.type,
            mode: s.mode,
            from: { name: s.from.name, id: s.from.id },
            to: { name: s.to.name, id: s.to.id },
            departureDateTime: parseNavitiaDateTime(s.departure_date_time),
            arrivalDateTime: parseNavitiaDateTime(s.arrival_date_time),
            duration: s.duration,
            displayInfo: s.display_informations ? {
                network: s.display_informations.network,
                commercialMode: s.display_informations.commercial_mode,
                direction: s.display_informations.direction,
                label: s.display_informations.label,
                color: s.display_informations.color,
                code: s.display_informations.code,
            } : undefined,
            stopCount: s.stop_date_times?.length,
        })),
    }));
}
