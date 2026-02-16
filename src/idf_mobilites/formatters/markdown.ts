import { Departure } from '../api/stops';
import { Journey } from '../api/journey';
import { Place, NearbyStop } from '../api/places';
import { Disruption } from '../api/traffic';
import { formatTime, relativeTime, formatDuration } from '../utils/time';

function statusEmoji(status: string): string {
    switch (status) {
        case 'onTime': return 'On Time';
        case 'delayed': return 'Delayed';
        case 'early': return 'Early';
        case 'cancelled': return 'Cancelled';
        default: return '?';
    }
}

function modeEmoji(mode: string): string {
    const m = mode.toLowerCase();
    if (m.includes('metro')) return 'Metro';
    if (m.includes('rer') || m.includes('train')) return 'Train';
    if (m.includes('bus')) return 'Bus';
    if (m.includes('tram')) return 'Tram';
    return mode;
}

export function formatDeparturesMd(
    departures: Departure[],
    timestamp: string,
    stopName?: string,
): string {
    if (!departures.length) return 'No departures found.';

    const name = stopName || departures[0]?.stopName || 'Unknown stop';
    const lines: string[] = [
        `## Next Departures: ${name}`,
        `Updated: ${formatTime(timestamp)}`,
        '',
        '| Line | Direction | Time | Status |',
        '|------|-----------|------|--------|',
    ];

    for (const dep of departures) {
        const time = dep.expectedDeparture
            ? `${formatTime(dep.expectedDeparture)} (${relativeTime(dep.expectedDeparture)})`
            : '??';
        const atStop = dep.atStop ? ' (approaching)' : '';
        lines.push(
            `| ${dep.line} | ${dep.destination} | ${time} | ${statusEmoji(dep.status)}${atStop} |`,
        );
    }

    return lines.join('\n');
}

export function formatJourneyMd(journeys: Journey[], from: string, to: string): string {
    if (!journeys.length) return 'No routes found.';

    const lines: string[] = [
        `## Journey: ${from} -> ${to}`,
        '',
    ];

    journeys.forEach((j, idx) => {
        if (journeys.length > 1) lines.push(`### Option ${idx + 1}`);
        lines.push(`**Departure:** ${formatTime(j.departureDateTime)} (${relativeTime(j.departureDateTime)})`);
        lines.push(`**Arrival:** ${formatTime(j.arrivalDateTime)}`);
        lines.push(`**Duration:** ${formatDuration(j.duration)}`);
        lines.push(`**Transfers:** ${j.nbTransfers}`);
        if (j.walkingDistance > 0) {
            lines.push(`**Walking:** ${j.walkingDistance}m`);
        }
        lines.push('');
        lines.push('### Route');

        let stepNum = 0;
        for (const s of j.sections) {
            if (s.type === 'public_transport' && s.displayInfo && s.from && s.to) {
                stepNum++;
                const di = s.displayInfo;
                lines.push(`${stepNum}. **${modeEmoji(di.commercialMode)} ${di.code || di.label}** (Direction: ${di.direction})`);
                lines.push(`   - Board at: ${s.from.name}`);
                lines.push(`   - Depart: ${formatTime(s.departureDateTime)}`);
                lines.push(`   - Get off at: ${s.to.name}`);
                lines.push(`   - Arrive: ${formatTime(s.arrivalDateTime)}`);
                if (s.stopCount) lines.push(`   - ${s.stopCount} stops`);
                lines.push('');
            } else if (s.type === 'street_network' && s.mode === 'walking' && s.duration > 60 && s.from && s.to) {
                lines.push(`- Walk ${s.from.name} -> ${s.to.name} (${formatDuration(s.duration)})`);
            } else if (s.type === 'transfer' && s.from) {
                lines.push(`- Transfer at ${s.from.name} (${formatDuration(s.duration)})`);
            }
        }

        if (journeys.length > 1) lines.push('---');
        lines.push('');
    });

    return lines.join('\n');
}

export function formatPlacesMd(places: Place[]): string {
    if (!places.length) return 'No places found.';

    const lines: string[] = [
        '## Search Results',
        '',
        '| Name | Type | ID |',
        '|------|------|----|',
    ];

    for (const p of places) {
        lines.push(`| ${p.label} | ${p.type} | \`${p.id}\` |`);
    }

    return lines.join('\n');
}

export function formatNearbyMd(stops: NearbyStop[]): string {
    if (!stops.length) return 'No nearby stops found.';

    const lines: string[] = [
        '## Nearby Stops',
        '',
        '| Stop | Distance | ID |',
        '|------|----------|----|',
    ];

    for (const s of stops) {
        lines.push(`| ${s.name} | ${s.distance}m | \`${s.id}\` |`);
    }

    return lines.join('\n');
}

export function formatDisruptionsMd(disruptions: Disruption[]): string {
    if (!disruptions.length) return 'No disruptions currently reported.';

    const lines: string[] = [
        '## Service Disruptions',
        '',
    ];

    for (const d of disruptions) {
        const lineNames = d.impactedLines.map((l) => `${l.mode} ${l.code}`).join(', ');
        lines.push(`### ${lineNames || 'General'} — ${d.severity}`);
        lines.push(`**Status:** ${d.status} | **Cause:** ${d.cause || 'N/A'}`);
        lines.push('');
        for (const msg of d.messages.slice(0, 2)) {
            lines.push(`> ${msg.text}`);
            lines.push('');
        }
    }

    return lines.join('\n');
}
