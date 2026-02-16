import { planJourney, JourneyOptions } from '../api/journey';
import { formatJourney } from '../formatters/text';
import { formatJourneyMd } from '../formatters/markdown';
import { formatJson } from '../formatters/json';
import { parseTime } from '../utils/time';

export interface ItineraryOptions {
    departAt?: string;
    arriveBy?: string;
    maxTransfers?: number;
    modes?: string;
    count?: number;
    format?: 'text' | 'markdown' | 'json';
}

export async function itinerary(from: string | undefined, to: string | undefined, options: ItineraryOptions): Promise<void> {
    if (!from || !to) {
        console.error('Usage: idf_mobilites itinerary <from> <to> [--depart-at HH:MM] [--arrive-by HH:MM] [--max-transfers N] [--modes metro,rer] [--count N] [--format text|markdown|json]');
        process.exit(1);
    }

    const journeyOpts: JourneyOptions = {};
    if (options.departAt) journeyOpts.departAt = parseTime(options.departAt);
    if (options.arriveBy) journeyOpts.arriveBy = parseTime(options.arriveBy);
    if (options.maxTransfers !== undefined) journeyOpts.maxTransfers = options.maxTransfers;
    if (options.count) journeyOpts.count = options.count;
    if (options.modes) journeyOpts.modes = options.modes.split(',').map((m) => m.trim());

    const journeys = await planJourney(from, to, journeyOpts);

    switch (options.format) {
        case 'json':
            console.log(formatJson({ from, to, journeys }));
            break;
        case 'markdown':
            console.log(formatJourneyMd(journeys, from, to));
            break;
        default:
            console.log(formatJourney(journeys, from, to));
    }
}
