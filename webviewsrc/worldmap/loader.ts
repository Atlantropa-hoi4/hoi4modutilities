import { WorldMapMessage, Province, WorldMapData, RequestMapItemMessage, State, Country, Point, ErrorMessage, ProgressMessage } from "./definitions";
import { copyArray } from "../util/common";
import { inBBox } from "./graphutils";
import { Subscriber } from "../util/event";
import { WorldMapWarning, WorldMapWarningSource, Terrain, StrategicRegion, SupplyArea, Railway, SupplyNode, Resource, River, Bookmark } from "../../src/previewdef/worldmap/definitions";
import { vscode } from "../util/vscode";
import { BehaviorSubject, fromEvent, Observable, ObservedValueOf, Subject } from 'rxjs';
import { ConditionItem } from "../../src/hoiformat/condition";

interface ExtraMapData {
    provincesCount: number;
    statesCount: number;
    countriesCount: number;
    railwaysCount: number;
    supplyNodesCount: number;
}

interface FEWorldMapClassExtra {
    getProvinceById(provinceId: number | undefined): Province | undefined;
    getStateById(stateId: number | undefined): State | undefined;
    getStrategicRegionById(strategicRegionId: number | undefined): StrategicRegion | undefined;
    getSupplyAreaById(supplyAreaId: number | undefined): SupplyArea | undefined;
    getCountryByTag(tag: string | undefined): Country | undefined;

    getStateByProvinceId(provinceId: number): State | undefined;
    getProvinceToStateMap(): Record<number, number | undefined>;
    
    getStrategicRegionByProvinceId(provinceId: number): StrategicRegion | undefined;
    getProvinceToStrategicRegionMap(): Record<number, number | undefined>;

    getSupplyAreaByStateId(stateId: number): SupplyArea | undefined;
    getStateToSupplyAreaMap(): Record<number, number | undefined>;

    getRailwayLevelByProvinceId(provinceId: number): number | undefined;

    getSupplyNodeByProvinceId(provinceId: number): SupplyNode | undefined;

    getProvinceByPosition(x: number, y: number): Province | undefined;

    getProvinceWarnings(province?: Province, state?: State, strategicRegion?: StrategicRegion, supplyArea?: SupplyArea): string[];
    getStateWarnings(state: State, supplyArea?: SupplyArea): string[];
    getStrategicRegionWarnings(strategicRegion: StrategicRegion): string[];
    getSupplyAreaWarnings(supplyArea: SupplyArea): string[];
    getRiverWarnings(riverIndex: number): string[];

    forEachProvince(callback: (province: Province) => boolean | void): void;
    forEachState(callback: (state: State) => boolean | void): void;
    forEachStrategicRegion(callback: (strategicRegion: StrategicRegion) => boolean | void): void;
    forEachSupplyArea(callback: (supplyArea: SupplyArea) => boolean | void): void;
    forEachRailway(callback: (railway: Railway) => boolean | void): void;
    forEachSupplyNode(callback: (supplyNode: SupplyNode) => boolean | void): void;
}

export type FEWorldMap = Omit<WorldMapData, 'states' | 'provinces' | 'strategicRegions' | 'supplyAreas' | 'railways' | 'supplyNodes'>
    & ExtraMapData & FEWorldMapClassExtra;

const provinceSpatialCellSize = 128;

interface ProvinceSpatialIndex {
    columns: number;
    rows: number;
    buckets: (Province[] | undefined)[];
}

interface WorldMapWarningIndex {
    provinceById: Map<number, number[]>;
    provinceByColor: Map<number, number[]>;
    stateById: Map<number, number[]>;
    strategicRegionById: Map<number, number[]>;
    supplyAreaById: Map<number, number[]>;
    riverByIndex: Map<number, number[]>;
}

export class Loader extends Subscriber {
    public worldMap: FEWorldMapClass;
    public loading$ = new BehaviorSubject<boolean>(false);
    public progress: number = 0;
    public progressText: string = '';
    public batchStats = { chunksReceived: 0, worldMapEmits: 0, maxInFlightRequests: 0 };

    private writableWorldMap$ = new Subject<FEWorldMap>();
    public worldMap$: Observable<FEWorldMap> = this.writableWorldMap$;

    private writableProgress$ = new BehaviorSubject({ progress: 0, progressText: '' });
    public progress$: Observable<ObservedValueOf<Loader['writableProgress$']>> = this.writableProgress$;

    private loadingProvinceMap: WorldMapData | undefined;
    private committedProvinceMap: WorldMapData | undefined;
    private loadingQueue: RequestMapItemMessage[] = [];
    private totalInitialRequests = 0;
    private completedInitialRequests = 0;
    private inFlightInitialRequests = 0;
    private initialLoadPending = false;
    private loadGeneration = 0;
    private readonly maxConcurrentRequests = 4;

    constructor() {
        super();
        this.worldMap = new FEWorldMapClass();
        this.load();
        this.addSubscription(this.worldMap$.subscribe(wm => (window as any)['worldMap'] = wm));
    }

    public refresh() {
        this.worldMap = new FEWorldMapClass();
        this.emitWorldMap();
        vscode.postMessage({ command: 'loaded', force: true } as WorldMapMessage);
        this.loading$.next(true);
    }

    private load() {
        this.addSubscription(fromEvent<MessageEvent>(window, 'message').subscribe(event => {
            const message = event.data as WorldMapMessage;
            switch (message.command) {
                case 'provincemapsummary':
                    if (message.loadGeneration !== undefined && message.loadGeneration < this.loadGeneration) {
                        break;
                    }
                    this.loadGeneration = message.loadGeneration ?? this.loadGeneration + 1;
                    this.loadingProvinceMap = { ...message.data };
                    this.loadingProvinceMap.conditionExprs ??= [];
                    this.loadingProvinceMap.bookmarks ??= [];
                    this.loadingProvinceMap.provinces = new Array(this.loadingProvinceMap.provincesCount);
                    this.loadingProvinceMap.states = new Array(this.loadingProvinceMap.statesCount);
                    this.loadingProvinceMap.countries = new Array(this.loadingProvinceMap.countriesCount);
                    this.loadingProvinceMap.strategicRegions = new Array(this.loadingProvinceMap.strategicRegionsCount);
                    this.loadingProvinceMap.supplyAreas = new Array(this.loadingProvinceMap.supplyAreasCount);
                    this.loadingProvinceMap.railways = new Array(this.loadingProvinceMap.railwaysCount);
                    this.loadingProvinceMap.supplyNodes = new Array(this.loadingProvinceMap.supplyNodesCount);
                    this.startLoading();
                    break;
                case 'provinces':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.provinces, message.start, message.end, message.data);
                    this.completeMapItem();
                    break;
                case 'states':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.states, message.start, message.end, message.data);
                    this.completeMapItem();
                    if (!this.initialLoadPending) {
                        if (message.count !== undefined && this.loadingProvinceMap) {
                            this.loadingProvinceMap.statesCount = message.count;
                        }
                        this.commitLiveUpdate();
                    }
                    break;
                case 'countries':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.countries, message.start, message.end, message.data);
                    this.completeMapItem();
                    break;
                case 'strategicregions':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.strategicRegions, message.start, message.end, message.data);
                    this.completeMapItem();
                    if (!this.initialLoadPending) {
                        if (message.count !== undefined && this.loadingProvinceMap) {
                            this.loadingProvinceMap.strategicRegionsCount = message.count;
                        }
                        this.commitLiveUpdate();
                    }
                    break;
                case 'supplyareas':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.supplyAreas, message.start, message.end, message.data);
                    this.completeMapItem();
                    break;
                case 'railways':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.railways, message.start, message.end, message.data);
                    this.completeMapItem();
                    break;
                case 'supplynodes':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.supplyNodes, message.start, message.end, message.data);
                    this.completeMapItem();
                    break;
                case 'warnings':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.warnings = decodeMapItemData<WorldMapWarning>(message.data);
                        this.completeMapItem();
                    }
                    break;
                case 'continents':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.continents = decodeMapItemData<string>(message.data);
                        this.completeMapItem();
                    }
                    break;
                case 'terrains':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.terrains = decodeMapItemData<Terrain>(message.data);
                        this.completeMapItem();
                    }
                    break;
                case 'resources':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.resources = decodeMapItemData<Resource>(message.data);
                        this.completeMapItem();
                    }
                    break;
                case 'rivers':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.rivers = decodeMapItemData<River>(message.data);
                        this.completeMapItem();
                    }
                    break;
                case 'conditionexprs':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.conditionExprs = decodeMapItemData<ConditionItem>(message.data);
                        this.completeMapItem();
                    }
                    break;
                case 'bookmarks':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.bookmarks = decodeMapItemData<Bookmark>(message.data);
                        this.completeMapItem();
                    }
                    break;
                case 'mapupdatecomplete':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message) && !this.initialLoadPending) {
                        this.committedProvinceMap = this.loadingProvinceMap;
                        this.worldMap = new FEWorldMapClass(this.loadingProvinceMap);
                        this.emitWorldMap();
                        this.loading$.next(false);
                        this.postMapReady();
                    }
                    break;
                case 'progress':
                    if (!this.acceptLoadStatusMessage(message)) {
                        break;
                    }
                    this.progressText = message.data;
                    if (this.progressText && !this.initialLoadPending) {
                        this.loading$.next(true);
                    }
                    this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
                    break;
                case 'error':
                    if (!this.acceptLoadStatusMessage(message)) {
                        break;
                    }
                    this.progressText = message.data;
                    this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
                    this.loading$.next(false);
                    break;
            }
        }));

        vscode.postMessage({ command: 'loaded', force: false } as WorldMapMessage);
        this.loading$.next(true);
    }

    private startLoading() {
        if (!this.loadingProvinceMap) {
            return;
        }
    
        this.loadingQueue.length = 0;
    
        this.queueLoadingRequest('requestcountries', this.loadingProvinceMap.countriesCount, 1000);
        this.queueLoadingRequest('requeststrategicregions', this.loadingProvinceMap.strategicRegionsCount, 1000);
        this.queueLoadingRequest('requeststrategicregions', -this.loadingProvinceMap.badStrategicRegionsCount, 1000, this.loadingProvinceMap.badStrategicRegionsCount);
        this.queueLoadingRequest('requestsupplyareas', this.loadingProvinceMap.supplyAreasCount, 1000);
        this.queueLoadingRequest('requestsupplyareas', -this.loadingProvinceMap.badSupplyAreasCount, 1000, this.loadingProvinceMap.badSupplyAreasCount);
        this.queueLoadingRequest('requeststates', this.loadingProvinceMap.statesCount, 1000);
        this.queueLoadingRequest('requeststates', -this.loadingProvinceMap.badStatesCount, 1000, this.loadingProvinceMap.badStatesCount);
        this.queueLoadingRequest('requestprovinces', this.loadingProvinceMap.provincesCount, 1000);
        this.queueLoadingRequest('requestprovinces', -this.loadingProvinceMap.badProvincesCount, 1000, this.loadingProvinceMap.badProvincesCount);
        this.queueLoadingRequest('requestrailways', this.loadingProvinceMap.railwaysCount, 2000);
        this.queueLoadingRequest('requestsupplynodes', this.loadingProvinceMap.supplyNodesCount, 4000);

        this.totalInitialRequests = this.loadingQueue.length;
        this.completedInitialRequests = 0;
        this.inFlightInitialRequests = 0;
        this.initialLoadPending = true;
        this.progress = 0;
        this.progressText = '';
        this.loading$.next(true);
        this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
        this.pumpInitialRequests();
    }

    private queueLoadingRequest<C extends RequestMapItemMessage['command']>(command: C, count: number, step: number, offset: number = 0) {
        for (let i = offset, j = 0; j < count; i += step, j += step) {
            this.loadingQueue.push({
                command,
                start: i,
                end: Math.min(i + step, offset + count),
                loadGeneration: this.loadGeneration,
            });
        }
    }

    private pumpInitialRequests(): void {
        while (this.initialLoadPending &&
            this.inFlightInitialRequests < this.maxConcurrentRequests &&
            this.loadingQueue.length > 0) {
            const request = this.loadingQueue.shift()!;
            this.inFlightInitialRequests++;
            this.batchStats.maxInFlightRequests = Math.max(
                this.batchStats.maxInFlightRequests,
                this.inFlightInitialRequests,
            );
            vscode.postMessage(request);
        }

        if (this.initialLoadPending && this.loadingQueue.length === 0 && this.inFlightInitialRequests === 0) {
            this.finishInitialLoad();
        }
    }

    private completeMapItem(): void {
        if (!this.initialLoadPending) {
            return;
        }

        this.inFlightInitialRequests = Math.max(0, this.inFlightInitialRequests - 1);
        this.completedInitialRequests++;
        this.progress = this.totalInitialRequests === 0 ? 1 :
            Math.min(1, this.completedInitialRequests / this.totalInitialRequests);
        this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
        this.pumpInitialRequests();
    }

    private finishInitialLoad(): void {
        if (!this.loadingProvinceMap) {
            return;
        }

        this.initialLoadPending = false;
        this.progress = 1;
        this.committedProvinceMap = this.loadingProvinceMap;
        this.worldMap = new FEWorldMapClass(this.loadingProvinceMap);
        this.emitWorldMap();
        this.loading$.next(false);
        this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
        this.postMapReady();
    }

    private postMapReady(): void {
        vscode.postMessage({ command: 'mapready', loadGeneration: this.loadGeneration } as WorldMapMessage);
    }

    private receiveData<T>(arr: T[] | undefined, start: number, end: number, data: unknown[] | string): void {
        if (arr) {
            copyArray(decodeMapItemData<T>(data), arr, 0, start, end - start);
            this.batchStats.chunksReceived++;
        }
    }

    private emitWorldMap(): void {
        this.batchStats.worldMapEmits++;
        this.writableWorldMap$.next(this.worldMap);
    }

    private isCurrentLoadMessage(message: WorldMapMessage): boolean {
        return !('loadGeneration' in message)
            || message.loadGeneration === undefined
            || message.loadGeneration === this.loadGeneration;
    }

    private commitLiveUpdate(): void {
        if (!this.loadingProvinceMap) {
            return;
        }
        this.committedProvinceMap = this.loadingProvinceMap;
        this.worldMap = new FEWorldMapClass(this.loadingProvinceMap);
        this.emitWorldMap();
    }

    private acceptLoadStatusMessage(message: ProgressMessage | ErrorMessage): boolean {
        const loadGeneration = message.loadGeneration;
        if (loadGeneration === undefined) {
            return true;
        }

        if (loadGeneration < this.loadGeneration) {
            return false;
        }

        if (loadGeneration > this.loadGeneration) {
            this.prepareDiffStagingMap();
        }
        this.loadGeneration = loadGeneration;
        return true;
    }

    private prepareDiffStagingMap(): void {
        const source = this.committedProvinceMap;
        if (!source) {
            return;
        }

        this.loadingProvinceMap = {
            ...source,
            provinces: source.provinces.slice(),
            states: source.states.slice(),
            countries: source.countries.slice(),
            strategicRegions: source.strategicRegions.slice(),
            supplyAreas: source.supplyAreas.slice(),
            railways: source.railways.slice(),
            supplyNodes: source.supplyNodes.slice(),
        };
    }

    public override dispose(): void {
        super.dispose();
        this.loadingQueue.length = 0;
        this.initialLoadPending = false;
        this.loadingProvinceMap = undefined;
        this.committedProvinceMap = undefined;
        (window as any)['worldMap'] = undefined;
        this.loading$.complete();
        this.writableWorldMap$.complete();
        this.writableProgress$.complete();
    }
}

function decodeMapItemData<T>(data: unknown[] | string): T[] {
    return (typeof data === 'string' ? JSON.parse(data) : data) as T[];
}

export class FEWorldMapClass implements FEWorldMap {
    width!: number;
    height!: number;
    provinceDefinitionsFile!: string | undefined;
    countries!: Country[];
    warnings!: WorldMapWarning[];
    provincesCount!: number;
    statesCount!: number;
    countriesCount!: number;
    strategicRegionsCount!: number;
    supplyAreasCount!: number;
    railwaysCount!: number;
    supplyNodesCount!: number;
    badProvincesCount!: number;
    badStatesCount!: number;
    badStrategicRegionsCount!: number;
    badSupplyAreasCount!: number;
    continents!: string[];
    terrains!: Terrain[];
    resources!: Resource[];
    rivers!: River[];
    conditionExprs!: ConditionItem[];
    bookmarks!: Bookmark[];

    private provinces!: (Province | null | undefined)[];
    private states!: (State | null | undefined)[];
    private strategicRegions!: (StrategicRegion | null | undefined)[];
    private supplyAreas!: (SupplyArea | null | undefined)[];
    private railways!: (Railway | null | undefined)[];
    private supplyNodes!: (SupplyNode | null | undefined)[];
    private provinceToStateMap?: Record<number, number | undefined>;
    private provinceToStrategicRegionMap?: Record<number, number | undefined>;
    private stateToSupplyAreaMap?: Record<number, number | undefined>;
    private railwayLevelByProvinceId?: Record<number, number | undefined>;
    private supplyNodeByProvinceId?: Record<number, SupplyNode | undefined>;
    private countryByTag?: Map<string, Country>;
    private provinceSpatialIndex?: ProvinceSpatialIndex;
    private warningIndex?: WorldMapWarningIndex;

    constructor(worldMap?: WorldMapData & ExtraMapData) {
        Object.assign(this, { conditionExprs: [], bookmarks: [] }, worldMap ?? ({
            width: 0, height: 0,
            provinces: [], states: [], countries: [], warnings: [], continents: [], strategicRegions: [], supplyAreas: [], terrains: [],
            railways: [], supplyNodes: [], resources: [], rivers: [],
            provincesCount: 0, statesCount: 0, countriesCount: 0, strategicRegionsCount: 0, supplyAreasCount: 0,
            badProvincesCount: 0, badStatesCount: 0, badStrategicRegionsCount: 0, badSupplyAreasCount: 0,
            railwaysCount: 0, supplyNodesCount: 0,
            conditionExprs: [], bookmarks: [], provinceDefinitionsFile: undefined
        } as WorldMapData & ExtraMapData));
    }

    public getProvinceById = (provinceId: number | undefined): Province | undefined => {
        return provinceId ? this.provinces[provinceId] ?? undefined : undefined;
    };

    public getStateById = (stateId: number | undefined): State | undefined => {
        return stateId ? this.states[stateId] ?? undefined : undefined;
    };

    public getStrategicRegionById = (strategicRegionId: number | undefined): StrategicRegion | undefined => {
        return strategicRegionId ? this.strategicRegions[strategicRegionId] ?? undefined : undefined;
    };

    public getSupplyAreaById = (supplyAreaId: number | undefined): SupplyArea | undefined => {
        return supplyAreaId ? this.supplyAreas[supplyAreaId] ?? undefined : undefined;
    };

    public getCountryByTag(tag: string | undefined): Country | undefined {
        if (tag === undefined) {
            return undefined;
        }

        if (!this.countryByTag) {
            const countryByTag = new Map<string, Country>();
            for (const country of this.countries) {
                if (country && !countryByTag.has(country.tag)) {
                    countryByTag.set(country.tag, country);
                }
            }
            this.countryByTag = countryByTag;
        }

        return this.countryByTag.get(tag);
    }

    public getStateByProvinceId(provinceId: number): State | undefined {
        return this.getStateById(this.getProvinceToStateMap()[provinceId]);
    }
    
    public getStrategicRegionByProvinceId(provinceId: number): StrategicRegion | undefined {
        return this.getStrategicRegionById(this.getProvinceToStrategicRegionMap()[provinceId]);
    }

    public getSupplyAreaByStateId(stateId: number): SupplyArea | undefined {
        return this.getSupplyAreaById(this.getStateToSupplyAreaMap()[stateId]);
    }

    public getRailwayLevelByProvinceId(provinceId: number): number | undefined {
        if (!this.railwayLevelByProvinceId) {
            const result: Record<number, number | undefined> = {};
            this.forEachRailway(railway => {
                railway.provinces.forEach(p => {
                    result[p] = Math.max(result[p] ?? -1, railway.level);
                });
            });
            this.railwayLevelByProvinceId = result;
        }

        return this.railwayLevelByProvinceId[provinceId];
    }

    public getSupplyNodeByProvinceId(provinceId: number): SupplyNode | undefined {
        if (!this.supplyNodeByProvinceId) {
            const result: Record<number, SupplyNode | undefined> = {};
            this.forEachSupplyNode(supplyNode => {
                result[supplyNode.province] = supplyNode;
            });
            this.supplyNodeByProvinceId = result;
        }

        return this.supplyNodeByProvinceId[provinceId];
    }
    
    public getProvinceByPosition(x: number, y: number): Province | undefined {
        const spatialIndex = this.getProvinceSpatialIndex();
        if (spatialIndex.columns === 0 || spatialIndex.rows === 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) {
            return undefined;
        }

        const point: Point = { x, y };
        const cellX = Math.floor(x / provinceSpatialCellSize);
        const cellY = Math.floor(y / provinceSpatialCellSize);
        const candidates = spatialIndex.buckets[cellY * spatialIndex.columns + cellX] ?? [];
        for (const province of candidates) {
            if (province.coverZones.some(z => inBBox(point, z))) {
                return province;
            }
        }

        return undefined;
    }

    private getProvinceSpatialIndex(): ProvinceSpatialIndex {
        if (this.provinceSpatialIndex) {
            return this.provinceSpatialIndex;
        }

        if (this.width <= 0 || this.height <= 0) {
            return this.provinceSpatialIndex = { columns: 0, rows: 0, buckets: [] };
        }

        const columns = Math.ceil(this.width / provinceSpatialCellSize);
        const rows = Math.ceil(this.height / provinceSpatialCellSize);
        const buckets: (Province[] | undefined)[] = new Array(columns * rows);
        this.forEachProvince(province => {
            for (const zone of province.coverZones) {
                const left = Math.max(0, zone.x);
                const top = Math.max(0, zone.y);
                const right = Math.min(this.width, zone.x + zone.w);
                const bottom = Math.min(this.height, zone.y + zone.h);
                if (right <= left || bottom <= top) {
                    continue;
                }

                const minCellX = Math.floor(left / provinceSpatialCellSize);
                const minCellY = Math.floor(top / provinceSpatialCellSize);
                const maxCellX = Math.floor((right - 1) / provinceSpatialCellSize);
                const maxCellY = Math.floor((bottom - 1) / provinceSpatialCellSize);
                for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
                    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
                        const index = cellY * columns + cellX;
                        const bucket = buckets[index] ??= [];
                        if (bucket[bucket.length - 1] !== province) {
                            bucket.push(province);
                        }
                    }
                }
            }
        });

        return this.provinceSpatialIndex = { columns, rows, buckets };
    }

    public getProvinceToStateMap(): Record<number, number | undefined> {
        if (this.provinceToStateMap) {
            return this.provinceToStateMap;
        }

        const result: Record<number, number | undefined> = {};
        this.forEachState(state =>
            state.provinces.forEach(p => {
                result[p] = state.id;
            })
        );
    
        return this.provinceToStateMap = result;
    }

    public getProvinceToStrategicRegionMap(): Record<number, number | undefined> {
        if (this.provinceToStrategicRegionMap) {
            return this.provinceToStrategicRegionMap;
        }

        const result: Record<number, number | undefined> = {};
        this.forEachStrategicRegion(strategicRegion =>
            strategicRegion.provinces.forEach(p => {
                result[p] = strategicRegion.id;
            })
        );
    
        return this.provinceToStrategicRegionMap = result;
    }

    public getStateToSupplyAreaMap(): Record<number, number | undefined> {
        if (this.stateToSupplyAreaMap) {
            return this.stateToSupplyAreaMap;
        }

        const result: Record<number, number | undefined> = {};
        this.forEachSupplyArea(supplyArea =>
            supplyArea.states.forEach(s => {
                result[s] = supplyArea.id;
            })
        );
    
        return this.stateToSupplyAreaMap = result;
    }

    public forEachProvince(callback: (province: Province) => boolean | void) {
        const count = this.provincesCount;
        for (let i = this.badProvincesCount; i < count; i++) {
            const province = this.provinces[i];
            if (province && callback(province)) {
                break;
            }
        }
    }

    public forEachState(callback: (state: State) => boolean | void) {
        const count = this.statesCount;
        for (let i = this.badStatesCount; i < count; i++) {
            const state = this.states[i];
            if (state && callback(state)) {
                break;
            }
        }
    }

    public forEachStrategicRegion(callback: (strategicRegion: StrategicRegion) => boolean | void): void {
        const count = this.strategicRegionsCount;
        for (let i = this.badStrategicRegionsCount; i < count; i++) {
            const strategicRegion = this.strategicRegions[i];
            if (strategicRegion && callback(strategicRegion)) {
                break;
            }
        }
    }
    
    public forEachSupplyArea(callback: (supplyArea: SupplyArea) => boolean | void): void {
        const count = this.supplyAreasCount;
        for (let i = this.badSupplyAreasCount; i < count; i++) {
            const supplyArea = this.supplyAreas[i];
            if (supplyArea && callback(supplyArea)) {
                break;
            }
        }
    }
    
    public forEachRailway(callback: (railway: Railway) => boolean | void): void {
        const count = this.railwaysCount;
        for (let i = 0; i < count; i++) {
            const railway = this.railways[i];
            if (railway && callback(railway)) {
                break;
            }
        }
    }
    
    public forEachSupplyNode(callback: (supplyNode: SupplyNode) => boolean | void): void {
        const count = this.supplyNodesCount;
        for (let i = 0; i < count; i++) {
            const supplyNode = this.supplyNodes[i];
            if (supplyNode && callback(supplyNode)) {
                break;
            }
        }
    }

    public getProvinceWarnings(province?: Province, state?: State, strategicRegion?: StrategicRegion, supplyArea?: SupplyArea): string[] {
        const index = this.getWarningIndex();
        return this.getWarningTexts(
            province ? index.provinceById.get(province.id) : undefined,
            province ? index.provinceByColor.get(province.color) : undefined,
            state ? index.stateById.get(state.id) : undefined,
            strategicRegion ? index.strategicRegionById.get(strategicRegion.id) : undefined,
            supplyArea ? index.supplyAreaById.get(supplyArea.id) : undefined,
        );
    }

    public getStateWarnings(state: State, supplyArea?: SupplyArea): string[] {
        const index = this.getWarningIndex();
        return this.getWarningTexts(
            index.stateById.get(state.id),
            supplyArea ? index.supplyAreaById.get(supplyArea.id) : undefined,
        );
    }

    public getStrategicRegionWarnings(strategicRegion: StrategicRegion): string[] {
        return this.getWarningTexts(this.getWarningIndex().strategicRegionById.get(strategicRegion.id));
    }
    
    public getSupplyAreaWarnings(supplyArea: SupplyArea): string[] {
        return this.getWarningTexts(this.getWarningIndex().supplyAreaById.get(supplyArea.id));
    }

    public getRiverWarnings(riverIndex: number): string[] {
        return this.getWarningTexts(this.getWarningIndex().riverByIndex.get(riverIndex));
    }

    private getWarningIndex(): WorldMapWarningIndex {
        if (this.warningIndex) {
            return this.warningIndex;
        }

        const warningIndex: WorldMapWarningIndex = {
            provinceById: new Map(),
            provinceByColor: new Map(),
            stateById: new Map(),
            strategicRegionById: new Map(),
            supplyAreaById: new Map(),
            riverByIndex: new Map(),
        };
        for (let warningIndexValue = 0; warningIndexValue < this.warnings.length; warningIndexValue++) {
            for (const source of this.warnings[warningIndexValue].source) {
                this.addWarningSourceToIndex(warningIndex, source, warningIndexValue);
            }
        }

        return this.warningIndex = warningIndex;
    }

    private addWarningSourceToIndex(index: WorldMapWarningIndex, source: WorldMapWarningSource, warningIndex: number): void {
        switch (source.type) {
            case 'province':
                if (source.id !== null) {
                    appendWarningIndex(index.provinceById, source.id, warningIndex);
                }
                appendWarningIndex(index.provinceByColor, source.color, warningIndex);
                break;
            case 'state':
                appendWarningIndex(index.stateById, source.id, warningIndex);
                break;
            case 'strategicregion':
                appendWarningIndex(index.strategicRegionById, source.id, warningIndex);
                break;
            case 'supplyarea':
                appendWarningIndex(index.supplyAreaById, source.id, warningIndex);
                break;
            case 'river':
                appendWarningIndex(index.riverByIndex, source.index, warningIndex);
                break;
        }
    }

    private getWarningTexts(...warningIndexes: (number[] | undefined)[]): string[] {
        const presentIndexes = warningIndexes.filter((value): value is number[] => value !== undefined && value.length > 0);
        if (presentIndexes.length === 0) {
            return [];
        }
        if (presentIndexes.length === 1) {
            return presentIndexes[0].map(index => this.warnings[index].text);
        }

        const mergedIndexes = new Set<number>();
        for (const indexes of presentIndexes) {
            for (const index of indexes) {
                mergedIndexes.add(index);
            }
        }
        return Array.from(mergedIndexes)
            .sort((left, right) => left - right)
            .map(index => this.warnings[index].text);
    }
}

function appendWarningIndex(index: Map<number, number[]>, key: number, warningIndex: number): void {
    const warningIndexes = index.get(key);
    if (!warningIndexes) {
        index.set(key, [warningIndex]);
    } else if (warningIndexes[warningIndexes.length - 1] !== warningIndex) {
        warningIndexes.push(warningIndex);
    }
}
