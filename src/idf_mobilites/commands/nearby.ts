import { findNearbyStops } from '../api/places';
import { searchPlaces } from '../api/places';
import { formatNearby } from '../formatters/text';
import { formatNearbyMd } from '../formatters/markdown';
import { formatJson } from '../formatters/json';

export interface NearbyOptions {
    radius?: number;
    format?: 'text' | 'markdown' | 'json';
}

export async function nearby(query: string | undefined, options: NearbyOptions): Promise<void> {
    if (!query) {
        console.error('Usage: idf_mobilites nearby <lat,lon|place_name> [--radius N] [--format text|markdown|json]');
        process.exit(1);
    }

    let lat: string;
    let lon: string;

    // Check if query is coordinates (lat,lon)
    const coordMatch = query.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
        lat = coordMatch[1];
        lon = coordMatch[2];
    } else {
        // Resolve place name to coordinates
        const places = await searchPlaces(query);
        const withCoords = places.find((p) => p.coord);
        if (!withCoords?.coord) {
            console.error(`Could not find coordinates for "${query}"`);
            process.exit(1);
        }
        lat = withCoords.coord.lat;
        lon = withCoords.coord.lon;
    }

    const stops = await findNearbyStops(lat, lon, options.radius);

    switch (options.format) {
        case 'json':
            console.log(formatJson(stops));
            break;
        case 'markdown':
            console.log(formatNearbyMd(stops));
            break;
        default:
            console.log(formatNearby(stops));
    }
}
