import { Departure } from '../api/stops';
import { Journey } from '../api/journey';
import { Place, NearbyStop } from '../api/places';
import { Disruption } from '../api/traffic';
import { formatTime, relativeTime, formatDuration } from '../utils/time';

function statusIcon(status: string): string {
    switch (status) {
        case 'onTime': return '[OK]';
        case 'delayed': return '[DELAYED]';
        case 'early': return '[EARLY]';
        case 'cancelled': return '[CANCELLED]';
        default: return '[?]';
    }
}

export function formatDepartures(
    departures: Departure[],
    timestamp: string,
    stopName?: string,
): string {
    if (!departures.length) return 'No departures found.';

    const name = stopName || departures[0]?.stopName || 'Unknown stop';
    const lines: string[] = [
        `Next Departures: ${name}`,
        `Updated: ${formatTime(timestamp)}`,
        '',
    ];

    // Group by direction
    const byDirection = new Map<string, Departure[]>();
    for (const dep of departures) {
        const key = `${dep.line} > ${dep.destination}`;
        if (!byDirection.has(key)) byDirection.set(key, []);
        byDirection.get(key)!.push(dep);
    }

    for (const [dir, deps] of byDirection) {
        lines.push(`  ${dir}`);
        lines.push(`  ${'-'.repeat(40)}`);
        for (const dep of deps) {
            const time = dep.expectedDeparture
                ? relativeTime(dep.expectedDeparture)
                : '??';
            const sched = dep.aimedDeparture ? formatTime(dep.aimedDeparture) : '';
            const status = statusIcon(dep.status);
            const atStop = dep.atStop ? ' (at stop)' : '';
            lines.push(`    ${time.padEnd(12)} ${sched.padEnd(8)} ${status}${atStop}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

export function formatJourney(journeys: Journey[], from: string, to: string): string {
    if (!journeys.length) return 'No routes found.';

    const lines: string[] = [
        `Itinerary: ${from} > ${to}`,
        '',
    ];

    journeys.forEach((j, idx) => {
        if (journeys.length > 1) lines.push(`--- Option ${idx + 1} ---`);
        lines.push(`  Depart:    ${formatTime(j.departureDateTime)} (${relativeTime(j.departureDateTime)})`);
        lines.push(`  Arrive:    ${formatTime(j.arrivalDateTime)}`);
        lines.push(`  Duration:  ${formatDuration(j.duration)}`);
        lines.push(`  Transfers: ${j.nbTransfers}`);
        if (j.walkingDistance > 0) {
            lines.push(`  Walking:   ${j.walkingDistance}m (${formatDuration(j.walkingDuration)})`);
        }
        lines.push('');

        let stepNum = 0;
        for (const s of j.sections) {
            if (s.type === 'public_transport' && s.displayInfo && s.from && s.to) {
                stepNum++;
                const di = s.displayInfo;
                lines.push(`  ${stepNum}. ${di.commercialMode} ${di.code || di.label} (Dir: ${di.direction})`);
                lines.push(`     Board at: ${s.from.name}`);
                lines.push(`     Depart:   ${formatTime(s.departureDateTime)}`);
                lines.push(`     Get off:  ${s.to.name}`);
                lines.push(`     Arrive:   ${formatTime(s.arrivalDateTime)}`);
                lines.push(`     Duration: ${formatDuration(s.duration)}${s.stopCount ? ` (${s.stopCount} stops)` : ''}`);
                lines.push('');
            } else if ((s.type === 'street_network' || s.type === 'transfer') && s.from && s.to) {
                const mode = s.mode === 'walking' ? 'Walk' : (s.mode || s.type);
                lines.push(`  >> ${mode}: ${s.from.name} -> ${s.to.name} (${formatDuration(s.duration)})`);
            }
        }

        if (journeys.length > 1) lines.push('');
    });

    return lines.join('\n');
}

export function formatPlaces(places: Place[]): string {
    if (!places.length) return 'No places found.';

    const lines: string[] = ['Search Results:', ''];
    for (const p of places) {
        const coords = p.coord ? ` (${p.coord.lat}, ${p.coord.lon})` : '';
        lines.push(`  [${p.type}] ${p.label}${coords}`);
        lines.push(`    ID: ${p.id}`);
    }
    return lines.join('\n');
}

export function formatNearby(stops: NearbyStop[]): string {
    if (!stops.length) return 'No nearby stops found.';

    const lines: string[] = ['Nearby Stops:', ''];
    for (const s of stops) {
        lines.push(`  ${s.name} (${s.distance}m)`);
        lines.push(`    ID: ${s.id}`);
    }
    return lines.join('\n');
}

export function formatDisruptions(disruptions: Disruption[]): string {
    if (!disruptions.length) return 'No disruptions currently reported.';

    const lines: string[] = ['Service Disruptions:', ''];
    for (const d of disruptions) {
        const lineNames = d.impactedLines.map((l) => `${l.mode} ${l.code}`).join(', ');
        lines.push(`  [${d.severity.toUpperCase()}] ${lineNames || 'General'}`);
        lines.push(`    Status: ${d.status} | Cause: ${d.cause || 'N/A'}`);
        for (const msg of d.messages.slice(0, 1)) {
            // Truncate long messages
            const text = msg.text.length > 120 ? msg.text.slice(0, 117) + '...' : msg.text;
            lines.push(`    ${text}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
