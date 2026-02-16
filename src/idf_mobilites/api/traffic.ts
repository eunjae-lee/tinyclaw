import { apiRequest } from './client';
import { CACHE_TTL } from '../utils/cache';

export interface Disruption {
    id: string;
    status: string; // 'active' | 'past' | 'future'
    severity: string;
    cause: string;
    category: string;
    messages: Array<{ text: string; channel: string }>;
    applicationPeriods: Array<{ begin: string; end: string }>;
    impactedLines: Array<{ id: string; name: string; code: string; mode: string }>;
    impactedStops: Array<{ id: string; name: string }>;
    updatedAt: string;
}

interface NavitiaDisruptionsResponse {
    disruptions: Array<{
        id: string;
        status: string;
        severity: { name: string; effect: string; priority: number };
        cause: string;
        category: string;
        messages: Array<{ text: string; channel: { name: string } }>;
        application_periods: Array<{ begin: string; end: string }>;
        impacted_objects: Array<{
            pt_object: {
                id: string;
                name: string;
                embedded_type: string;
                line?: { id: string; name: string; code: string; commercial_mode: { name: string } };
                stop_area?: { id: string; name: string };
            };
        }>;
        updated_at: string;
    }>;
    error?: { id: string; message: string };
}

export async function getDisruptions(lineId?: string): Promise<Disruption[]> {
    let endpoint = '/v2/navitia/coverage/fr-idf/disruptions';
    const params: Record<string, string> = { count: '50' };

    if (lineId) {
        endpoint = `/v2/navitia/coverage/fr-idf/lines/${lineId}/disruptions`;
    }

    const cacheKey = `disruptions:${lineId || 'all'}`;
    const data = await apiRequest<NavitiaDisruptionsResponse>(
        endpoint,
        params,
        cacheKey,
        CACHE_TTL.traffic,
    );

    if (!data.disruptions) return [];

    return data.disruptions.map((d) => {
        const lines: Disruption['impactedLines'] = [];
        const stops: Disruption['impactedStops'] = [];

        for (const io of d.impacted_objects || []) {
            if (io.pt_object.line) {
                lines.push({
                    id: io.pt_object.line.id,
                    name: io.pt_object.line.name,
                    code: io.pt_object.line.code,
                    mode: io.pt_object.line.commercial_mode?.name || '',
                });
            }
            if (io.pt_object.stop_area) {
                stops.push({
                    id: io.pt_object.stop_area.id,
                    name: io.pt_object.stop_area.name,
                });
            }
        }

        return {
            id: d.id,
            status: d.status,
            severity: d.severity?.name || 'unknown',
            cause: d.cause || '',
            category: d.category || '',
            messages: (d.messages || []).map((m) => ({
                text: m.text,
                channel: m.channel?.name || '',
            })),
            applicationPeriods: (d.application_periods || []).map((p) => ({
                begin: p.begin,
                end: p.end,
            })),
            impactedLines: lines,
            impactedStops: stops,
            updatedAt: d.updated_at || '',
        };
    });
}
