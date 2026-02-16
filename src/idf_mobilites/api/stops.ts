import { apiRequest } from './client';
import { CACHE_TTL } from '../utils/cache';

// SIRI response types
export interface MonitoredStopVisit {
    RecordedAtTime: string;
    ItemIdentifier: string;
    MonitoringRef: { value: string };
    MonitoredVehicleJourney: {
        LineRef: { value: string };
        OperatorRef: { value: string };
        DirectionName: Array<{ value: string }>;
        DirectionRef: { value: string };
        FramedVehicleJourneyRef: {
            DataFrameRef: { value: string };
            DatedVehicleJourneyRef: string;
        };
        JourneyNote: Array<{ value: string }>;
        DestinationRef: { value: string };
        DestinationName: Array<{ value: string }>;
        MonitoredCall: {
            StopPointName: Array<{ value: string }>;
            VehicleAtStop: boolean;
            DestinationDisplay: Array<{ value: string }>;
            ExpectedArrivalTime?: string;
            ExpectedDepartureTime?: string;
            AimedArrivalTime?: string;
            AimedDepartureTime?: string;
            ArrivalStatus?: string;
            DepartureStatus?: string;
        };
    };
}

export interface StopMonitoringResponse {
    Siri: {
        ServiceDelivery: {
            ResponseTimestamp: string;
            ProducerRef: { value: string };
            ResponseMessageIdentifier: { value: string };
            StopMonitoringDelivery: Array<{
                ResponseTimestamp: string;
                Version: string;
                Status: string;
                MonitoredStopVisit: MonitoredStopVisit[];
            }>;
        };
    };
}

export interface Departure {
    line: string;
    lineRef: string;
    direction: string;
    destination: string;
    stopName: string;
    expectedDeparture: string | null;
    aimedDeparture: string | null;
    status: 'onTime' | 'delayed' | 'early' | 'cancelled' | 'unknown';
    atStop: boolean;
    journeyNote: string;
}

function parseDepartureStatus(visit: MonitoredStopVisit): Departure['status'] {
    const mc = visit.MonitoredVehicleJourney.MonitoredCall;
    const depStatus = mc.DepartureStatus || mc.ArrivalStatus || '';
    if (depStatus === 'cancelled') return 'cancelled';
    if (!mc.ExpectedDepartureTime && !mc.ExpectedArrivalTime) return 'unknown';

    const aimed = mc.AimedDepartureTime || mc.AimedArrivalTime;
    const expected = mc.ExpectedDepartureTime || mc.ExpectedArrivalTime;
    if (aimed && expected) {
        const diff = new Date(expected).getTime() - new Date(aimed).getTime();
        if (diff > 60000) return 'delayed';
        if (diff < -60000) return 'early';
    }
    return 'onTime';
}

function parseLineShortName(lineRef: string): string {
    // Extract a readable line name from refs like "STIF:Line::C01374:"
    // The code after C is the line identifier
    const match = lineRef.match(/C(\d+)/);
    return match ? match[1] : lineRef;
}

function parseDepartures(data: StopMonitoringResponse): Departure[] {
    const deliveries = data.Siri?.ServiceDelivery?.StopMonitoringDelivery;
    if (!deliveries?.length) return [];

    const visits = deliveries[0].MonitoredStopVisit || [];
    return visits.map((visit) => {
        const vj = visit.MonitoredVehicleJourney;
        const mc = vj.MonitoredCall;
        return {
            line: vj.JourneyNote?.[0]?.value || parseLineShortName(vj.LineRef?.value || ''),
            lineRef: vj.LineRef?.value || '',
            direction: vj.DirectionName?.[0]?.value || '',
            destination: mc.DestinationDisplay?.[0]?.value || vj.DestinationName?.[0]?.value || '',
            stopName: mc.StopPointName?.[0]?.value || '',
            expectedDeparture: mc.ExpectedDepartureTime || mc.ExpectedArrivalTime || null,
            aimedDeparture: mc.AimedDepartureTime || mc.AimedArrivalTime || null,
            status: parseDepartureStatus(visit),
            atStop: mc.VehicleAtStop || false,
            journeyNote: vj.JourneyNote?.[0]?.value || '',
        };
    }).sort((a, b) => {
        const timeA = a.expectedDeparture || a.aimedDeparture || '';
        const timeB = b.expectedDeparture || b.aimedDeparture || '';
        return timeA.localeCompare(timeB);
    });
}

export async function getNextDepartures(
    monitoringRef: string,
    lineRef?: string,
): Promise<{ departures: Departure[]; timestamp: string }> {
    const params: Record<string, string> = { MonitoringRef: monitoringRef };
    if (lineRef) params.LineRef = lineRef;

    const cacheKey = `departures:${monitoringRef}:${lineRef || ''}`;
    const data = await apiRequest<StopMonitoringResponse>(
        '/stop-monitoring',
        params,
        cacheKey,
        CACHE_TTL.departures,
    );

    const timestamp = data.Siri?.ServiceDelivery?.ResponseTimestamp || new Date().toISOString();
    return { departures: parseDepartures(data), timestamp };
}
