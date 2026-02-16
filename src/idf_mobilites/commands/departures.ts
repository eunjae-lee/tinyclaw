import { getNextDepartures } from '../api/stops';
import { searchPlaces } from '../api/places';
import { formatDepartures } from '../formatters/text';
import { formatDeparturesMd } from '../formatters/markdown';
import { formatJson } from '../formatters/json';

export interface DeparturesOptions {
    stopId?: string;
    line?: string;
    count?: number;
    format?: 'text' | 'markdown' | 'json';
}

export async function departures(query: string | undefined, options: DeparturesOptions): Promise<void> {
    let monitoringRef = options.stopId;
    let stopName = query;

    if (!monitoringRef) {
        if (!query) {
            console.error('Usage: idf_mobilites departures <stop_name> [--stop-id ID] [--line LINE] [--count N] [--format text|markdown|json]');
            process.exit(1);
        }
        // Resolve stop name to ID
        const places = await searchPlaces(query, 'stop_area');
        if (!places.length) {
            console.error(`No stops found for "${query}"`);
            process.exit(1);
        }
        monitoringRef = places[0].id;
        stopName = places[0].name;
    }

    const { departures: deps, timestamp } = await getNextDepartures(monitoringRef, options.line);

    // Apply count limit
    const limited = options.count ? deps.slice(0, options.count) : deps;

    switch (options.format) {
        case 'json':
            console.log(formatJson({ departures: limited, timestamp, stopName }));
            break;
        case 'markdown':
            console.log(formatDeparturesMd(limited, timestamp, stopName));
            break;
        default:
            console.log(formatDepartures(limited, timestamp, stopName));
    }
}
