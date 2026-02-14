#!/usr/bin/env node

import { readDaily, readMidterm, readLongterm, getMemoryForInjection } from './read';
import { writeToLongterm } from './write';
import { log } from '../lib/logging';

const args = process.argv.slice(2);
const command = args[0];

function usage(): void {
    console.error('Usage: tinyclaw memory <command>');
    console.error('');
    console.error('Commands:');
    console.error('  read [--layer daily|mid-term|long-term|all]  Read memory layers (default: daily + mid-term)');
    console.error('  write "<text>"                               Write a fact to long-term memory');
    console.error('  ingest                                       Ingest session transcripts into daily memory');
    console.error('  promote daily                                Promote daily logs to mid-term memory');
    console.error('  promote weekly                               Promote mid-term to long-term memory');
    console.error('  inject                                       Output formatted memory for system prompt injection');
    console.error('  status                                       Show memory file status');
    process.exit(1);
}

async function main(): Promise<void> {
    log('INFO', `Memory CLI: command="${command}" args=[${args.slice(1).join(', ')}]`);

    switch (command) {
        case 'read': {
            const layerIdx = args.indexOf('--layer');
            const layer = layerIdx !== -1 ? args[layerIdx + 1] : undefined;

            switch (layer) {
                case 'daily':
                    console.log(readDaily());
                    break;
                case 'mid-term':
                    console.log(readMidterm());
                    break;
                case 'long-term':
                    console.log(readLongterm());
                    break;
                case 'all':
                    const lt = readLongterm();
                    const mt = readMidterm();
                    const dl = readDaily();
                    if (lt) { console.log('## Long-term Memory\n'); console.log(lt); console.log(''); }
                    if (mt) { console.log('## Mid-term Memory\n'); console.log(mt); console.log(''); }
                    if (dl) { console.log('## Today\'s Daily Log\n'); console.log(dl); }
                    if (!lt && !mt && !dl) { console.log('No memory files found.'); }
                    break;
                default:
                    // Default: show daily + mid-term
                    const midterm = readMidterm();
                    const daily = readDaily();
                    if (midterm) { console.log('## Mid-term Memory\n'); console.log(midterm); console.log(''); }
                    if (daily) { console.log('## Today\'s Daily Log\n'); console.log(daily); }
                    if (!midterm && !daily) { console.log('No memory files found.'); }
                    break;
            }
            break;
        }

        case 'write': {
            const text = args.slice(1).join(' ');
            if (!text) {
                console.error('Usage: tinyclaw memory write "<text>"');
                process.exit(1);
            }
            writeToLongterm(text);
            console.log('Written to long-term memory.');
            break;
        }

        case 'ingest': {
            const { ingestSessions } = await import('./ingest');
            await ingestSessions();
            break;
        }

        case 'promote': {
            const subcommand = args[1];
            if (subcommand === 'daily') {
                const { promoteDailyToMidterm } = await import('./promote');
                await promoteDailyToMidterm();
            } else if (subcommand === 'weekly') {
                const { promoteToLongterm } = await import('./promote');
                await promoteToLongterm();
            } else {
                console.error('Usage: tinyclaw memory promote {daily|weekly}');
                process.exit(1);
            }
            break;
        }

        case 'inject': {
            const content = getMemoryForInjection();
            if (content) {
                console.log(content);
            }
            break;
        }

        case 'status': {
            const { TINYCLAW_MEMORY_HOME } = await import('../lib/config');
            const fs = await import('fs');
            const path = await import('path');

            const layers = [
                { name: 'Long-term', file: path.join(TINYCLAW_MEMORY_HOME, 'long-term.md') },
                { name: 'Mid-term', file: path.join(TINYCLAW_MEMORY_HOME, 'mid-term.md') },
            ];

            console.log('Memory Status:');
            console.log(`  Home: ${TINYCLAW_MEMORY_HOME}`);
            console.log('');

            for (const layer of layers) {
                if (fs.existsSync(layer.file)) {
                    const stat = fs.statSync(layer.file);
                    const size = stat.size;
                    const modified = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
                    console.log(`  ${layer.name}: ${size} bytes (updated ${modified})`);
                } else {
                    console.log(`  ${layer.name}: not yet created`);
                }
            }

            const dailyDir = path.join(TINYCLAW_MEMORY_HOME, 'daily');
            if (fs.existsSync(dailyDir)) {
                const files = fs.readdirSync(dailyDir).filter((f: string) => f.endsWith('.md')).sort().reverse();
                console.log(`  Daily logs: ${files.length} files`);
                if (files.length > 0) {
                    console.log(`    Latest: ${files[0]}`);
                }
            } else {
                console.log('  Daily logs: none');
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
