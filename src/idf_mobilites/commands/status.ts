import { getDisruptions } from '../api/traffic';
import { formatDisruptions } from '../formatters/text';
import { formatDisruptionsMd } from '../formatters/markdown';
import { formatJson } from '../formatters/json';

export interface StatusOptions {
    line?: string;
    disruptions?: boolean;
    format?: 'text' | 'markdown' | 'json';
}

export async function status(options: StatusOptions): Promise<void> {
    const lineId = options.line ? resolveLineId(options.line) : undefined;
    const disruptions = await getDisruptions(lineId);

    switch (options.format) {
        case 'json':
            console.log(formatJson(disruptions));
            break;
        case 'markdown':
            console.log(formatDisruptionsMd(disruptions));
            break;
        default:
            console.log(formatDisruptions(disruptions));
    }
}

/**
 * Try to resolve a user-friendly line name to a navitia line ID.
 * Handles common patterns like "Metro 4", "RER B", "Bus 29", etc.
 */
function resolveLineId(line: string): string {
    // If already a navitia ID, return as-is
    if (line.startsWith('line:')) return line;

    // Normalize: "Metro 4" -> mode=metro, code=4
    const match = line.match(/^(metro|rer|bus|tram|train)\s*(.+)$/i);
    if (match) {
        const mode = match[1].toLowerCase();
        const code = match[2].trim().toUpperCase();
        // Navitia line IDs follow patterns like "line:IDFM:C01374"
        // We can't resolve these without an API call, so pass as a search hint
        return `line:IDFM:${mode}${code}`;
    }

    return line;
}
