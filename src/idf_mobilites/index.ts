#!/usr/bin/env node

import { log } from '../lib/logging';
import { cacheClear, cacheStats } from './utils/cache';

const args = process.argv.slice(2);
const command = args[0];

function usage(): void {
    console.error('Usage: tinyclaw feature idf_mobilites <command> [options]');
    console.error('');
    console.error('Commands:');
    console.error('  departures <stop>          Show next departures at a stop');
    console.error('  itinerary <from> <to>      Plan a journey from A to B');
    console.error('  search <query>             Search for stops, addresses, POIs');
    console.error('  nearby <lat,lon|place>     Find nearby stops');
    console.error('  status                     Show service disruptions');
    console.error('  cache clear|stats          Manage cache');
    console.error('');
    console.error('Options (vary by command):');
    console.error('  --format text|markdown|json   Output format (default: text)');
    console.error('  --stop-id ID                  Stop ID for departures');
    console.error('  --line LINE                   Filter by line');
    console.error('  --count N                     Limit results');
    console.error('  --depart-at HH:MM             Departure time');
    console.error('  --arrive-by HH:MM             Arrival time');
    console.error('  --max-transfers N              Max transfers');
    console.error('  --modes metro,rer,bus          Allowed modes');
    console.error('  --radius N                     Search radius in meters');
    console.error('  --type stop_area|address|poi   Place type filter');
    process.exit(1);
}

function getOpt(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
}

function hasFlag(flag: string): boolean {
    return args.includes(flag);
}

function getPositionalArgs(): string[] {
    // Return args that aren't the command and aren't --flag or flag values
    const positional: string[] = [];
    let i = 1; // skip command
    while (i < args.length) {
        if (args[i].startsWith('--')) {
            i += 2; // skip flag and value
        } else {
            positional.push(args[i]);
            i++;
        }
    }
    return positional;
}

async function main(): Promise<void> {
    log('INFO', `IDF Mobilites CLI: command="${command}" args=[${args.slice(1).join(', ')}]`);

    const format = (getOpt('--format') || 'text') as 'text' | 'markdown' | 'json';

    switch (command) {
        case 'departures': {
            const { departures } = await import('./commands/departures');
            const positional = getPositionalArgs();
            await departures(positional[0], {
                stopId: getOpt('--stop-id'),
                line: getOpt('--line'),
                count: getOpt('--count') ? parseInt(getOpt('--count')!, 10) : undefined,
                format,
            });
            break;
        }

        case 'itinerary': {
            const { itinerary } = await import('./commands/itinerary');
            const positional = getPositionalArgs();
            await itinerary(positional[0], positional[1], {
                departAt: getOpt('--depart-at'),
                arriveBy: getOpt('--arrive-by'),
                maxTransfers: getOpt('--max-transfers') ? parseInt(getOpt('--max-transfers')!, 10) : undefined,
                modes: getOpt('--modes'),
                count: getOpt('--count') ? parseInt(getOpt('--count')!, 10) : undefined,
                format,
            });
            break;
        }

        case 'search': {
            const { search } = await import('./commands/search');
            const positional = getPositionalArgs();
            await search(positional[0], {
                type: getOpt('--type'),
                format,
            });
            break;
        }

        case 'nearby': {
            const { nearby } = await import('./commands/nearby');
            const positional = getPositionalArgs();
            await nearby(positional[0], {
                radius: getOpt('--radius') ? parseInt(getOpt('--radius')!, 10) : undefined,
                format,
            });
            break;
        }

        case 'status': {
            const { status } = await import('./commands/status');
            await status({
                line: getOpt('--line'),
                disruptions: hasFlag('--disruptions'),
                format,
            });
            break;
        }

        case 'cache': {
            const sub = args[1];
            if (sub === 'clear') {
                const cleared = cacheClear();
                console.log(`Cache cleared (${cleared} entries removed).`);
            } else if (sub === 'stats') {
                const stats = cacheStats();
                console.log(`Cache: ${stats.entries} entries, ${stats.expired} expired.`);
            } else {
                console.error('Usage: idf_mobilites cache clear|stats');
                process.exit(1);
            }
            break;
        }

        default:
            usage();
    }
}

main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
