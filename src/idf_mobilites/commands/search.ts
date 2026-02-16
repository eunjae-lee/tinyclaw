import { searchPlaces } from '../api/places';
import { formatPlaces } from '../formatters/text';
import { formatPlacesMd } from '../formatters/markdown';
import { formatJson } from '../formatters/json';

export interface SearchOptions {
    type?: string;
    format?: 'text' | 'markdown' | 'json';
}

export async function search(query: string | undefined, options: SearchOptions): Promise<void> {
    if (!query) {
        console.error('Usage: idf_mobilites search <query> [--type stop_area|stop_point|address|poi] [--format text|markdown|json]');
        process.exit(1);
    }

    const places = await searchPlaces(query, options.type);

    switch (options.format) {
        case 'json':
            console.log(formatJson(places));
            break;
        case 'markdown':
            console.log(formatPlacesMd(places));
            break;
        default:
            console.log(formatPlaces(places));
    }
}
