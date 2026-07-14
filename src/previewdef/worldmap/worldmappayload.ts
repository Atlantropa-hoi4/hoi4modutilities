import { MapItemMessage, RequestMapItemMessage, WorldMapData, WorldMapMessage } from './definitions';

type MapItemCommand = MapItemMessage['command'];
type RequestMapItemCommand = RequestMapItemMessage['command'];
type WorldMapCollectionKey = 'provinces' | 'states' | 'countries' | 'strategicRegions' | 'supplyAreas' | 'railways' | 'supplyNodes';

const requestTargets: Record<RequestMapItemCommand, { command: MapItemCommand; key: WorldMapCollectionKey }> = {
    requestprovinces: { command: 'provinces', key: 'provinces' },
    requeststates: { command: 'states', key: 'states' },
    requestcountries: { command: 'countries', key: 'countries' },
    requeststrategicregions: { command: 'strategicregions', key: 'strategicRegions' },
    requestsupplyareas: { command: 'supplyareas', key: 'supplyAreas' },
    requestrailways: { command: 'railways', key: 'railways' },
    requestsupplynodes: { command: 'supplynodes', key: 'supplyNodes' },
};

export function createWorldMapSummary(worldMap: WorldMapData): WorldMapData {
    return {
        ...worldMap,
        provinces: [],
        states: [],
        countries: [],
        strategicRegions: [],
        supplyAreas: [],
        railways: [],
        supplyNodes: [],
    };
}

export function resolveWorldMapRequest(
    worldMap: WorldMapData,
    request: RequestMapItemMessage,
): { command: MapItemCommand; value: unknown[] } {
    const target = requestTargets[request.command];
    return {
        command: target.command,
        value: worldMap[target.key],
    };
}

export function getWorldMapMessageMetrics(message: WorldMapMessage): Record<string, number> {
    if ('data' in message) {
        if (Array.isArray(message.data)) {
            return { itemCount: message.data.length };
        }
        if (typeof message.data === 'string') {
            return { payloadBytes: message.data.length, size: message.data.length };
        }
    }

    if ('dataUrl' in message && typeof message.dataUrl === 'string') {
        return { payloadBytes: message.dataUrl.length, size: message.dataUrl.length };
    }

    return {};
}
