import { WorldMapMessage, Province, WorldMapData, RequestMapItemMessage, State, Country, Point } from "./definitions";
import { copyArray } from "../util/common";
import { inBBox } from "./graphutils";
import { Subscriber } from "../util/event";
import { WorldMapWarning, Terrain, StrategicRegion, SupplyArea, Railway, SupplyNode, Resource, River, Bookmark } from "../../src/previewdef/worldmap/definitions";
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

export class Loader extends Subscriber {
    public worldMap: FEWorldMapClass;
    public loading$ = new BehaviorSubject<boolean>(false);
    public progress: number = 0;
    public progressText: string = '';
    public batchStats = { chunksReceived: 0, worldMapEmits: 0 };

    private writableWorldMap$ = new Subject<FEWorldMap>();
    public worldMap$: Observable<FEWorldMap> = this.writableWorldMap$;

    private writableProgress$ = new BehaviorSubject({ progress: 0, progressText: '' });
    public progress$: Observable<ObservedValueOf<Loader['writableProgress$']>> = this.writableProgress$;

    private loadingProvinceMap: WorldMapData & { provincesCount: number; statesCount: number; countriesCount: number; } | undefined;
    private loadingQueue: WorldMapMessage[] = [];
    private loadingQueueStartLength = 0;
    private loadGeneration = 0;
    private pendingWorldMapEmit = false;

    constructor() {
        super();
        this.worldMap = new FEWorldMapClass();
        this.load();
        this.worldMap$.subscribe(wm => (window as any)['worldMap'] = wm);
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
                    this.loadGeneration = message.loadGeneration ?? this.loadGeneration + 1;
                    this.loadingProvinceMap = { ...message.data };
                    this.loadingProvinceMap.conditionExprs ??= [];
                    this.loadingProvinceMap.bookmarks ??= [];
                    this.loadingProvinceMap.provinces = new Array(this.loadingProvinceMap.provincesCount);
                    this.loadingProvinceMap.states = new Array(this.loadingProvinceMap.statesCount);
                    this.loadingProvinceMap.countries = new Array(this.loadingProvinceMap.countriesCount);
                    this.loadingProvinceMap.strategicRegions = new Array(this.loadingProvinceMap.strategicRegionsCount);
                    this.startLoading();
                    break;
                case 'provinces':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.provinces, message.start, message.end, message.data);
                    this.loadNext(false);
                    break;
                case 'states':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.states, message.start, message.end, message.data);
                    this.loadNext(false);
                    break;
                case 'countries':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.countries, message.start, message.end, message.data);
                    this.loadNext(false);
                    break;
                case 'strategicregions':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.strategicRegions, message.start, message.end, message.data);
                    this.loadNext(false);
                    break;
                case 'supplyareas':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.supplyAreas, message.start, message.end, message.data);
                    this.loadNext(false);
                    break;
                case 'railways':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.railways, message.start, message.end, message.data);
                    this.loadNext(false);
                    break;
                case 'supplynodes':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.receiveData(this.loadingProvinceMap?.supplyNodes, message.start, message.end, message.data);
                    this.loadNext(false);
                    break;
                case 'warnings':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.warnings = JSON.parse(message.data);
                        this.loadNext(false);
                    }
                    break;
                case 'continents':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.continents = JSON.parse(message.data);
                        this.loadNext(false);
                    }
                    break;
                case 'terrains':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.terrains = JSON.parse(message.data);
                        this.loadNext(false);
                    }
                    break;
                case 'resources':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.resources = JSON.parse(message.data);
                        this.loadNext(false);
                    }
                    break;
                case 'rivers':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.rivers = JSON.parse(message.data);
                        this.loadNext(false);
                    }
                    break;
                case 'conditionexprs':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.conditionExprs = JSON.parse(message.data);
                        this.loadNext(false);
                    }
                    break;
                case 'bookmarks':
                    if (this.loadingProvinceMap && this.isCurrentLoadMessage(message)) {
                        this.loadingProvinceMap.bookmarks = JSON.parse(message.data);
                        this.loadNext(false);
                    }
                    break;
                case 'progress':
                    if (!this.isCurrentLoadMessage(message)) {
                        break;
                    }
                    this.progressText = message.data;
                    this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
                    break;
                case 'error':
                    if (!this.isCurrentLoadMessage(message)) {
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

        this.loadingQueueStartLength = this.loadingQueue.length;
        this.progressText = '';
        this.worldMap = new FEWorldMapClass(this.loadingProvinceMap);
        this.scheduleWorldMapEmit();
        this.loadNext();
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

    private loadNext(updateMap: boolean = false) {
        this.progress = 1 - this.loadingQueue.length / this.loadingQueueStartLength;
    
        if (updateMap) {
            this.worldMap = new FEWorldMapClass(this.loadingProvinceMap!);
            this.scheduleWorldMapEmit();
        }
    
        if (this.loadingQueue.length === 0) {
            this.worldMap = new FEWorldMapClass(this.loadingProvinceMap!);
            this.emitWorldMap();
            this.loading$.next(false);
        } else {
            vscode.postMessage(this.loadingQueue.shift());
        }

        this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
    }
    
    private receiveData<T>(arr: T[] | undefined, start: number, end: number, data: string): void {
        if (arr) {
            copyArray(JSON.parse(data), arr, 0, start, end - start);
            this.batchStats.chunksReceived++;
        }
    }

    private scheduleWorldMapEmit(): void {
        if (this.pendingWorldMapEmit) {
            return;
        }

        this.pendingWorldMapEmit = true;
        const schedule = typeof requestAnimationFrame === 'function' ?
            requestAnimationFrame :
            (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0);
        schedule(() => {
            this.pendingWorldMapEmit = false;
            if (this.loading$.value) {
                this.emitWorldMap();
            }
        });
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
}

export class FEWorldMapClass implements FEWorldMap {
    width!: number;
    height!: number;
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

    constructor(worldMap?: WorldMapData & ExtraMapData) {
        Object.assign(this, { conditionExprs: [], bookmarks: [] }, worldMap ?? ({
            width: 0, height: 0,
            provinces: [], states: [], countries: [], warnings: [], continents: [], strategicRegions: [], supplyAreas: [], terrains: [],
            railways: [], supplyNodes: [], resources: [], rivers: [],
            provincesCount: 0, statesCount: 0, countriesCount: 0, strategicRegionsCount: 0, supplyAreasCount: 0,
            badProvincesCount: 0, badStatesCount: 0, badStrategicRegionsCount: 0, badSupplyAreasCount: 0,
            railwaysCount: 0, supplyNodesCount: 0,
            conditionExprs: [], bookmarks: []
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
        const point: Point = { x, y };
        let resultProvince: Province | undefined = undefined;
        this.forEachProvince(province => {
            if (inBBox(point, province.boundingBox) && province.coverZones.some(z => inBBox(point, z))) {
                resultProvince = province;
                return true;
            }
        });
        return resultProvince;
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
        return this.warnings
            .filter(v => v.source.some(s =>
                (province && s.type === 'province' && (s.id === province.id || s.color === province.color)) || 
                (state && s.type === 'state' && s.id === state.id) ||
                (strategicRegion && s.type === 'strategicregion' && s.id === strategicRegion.id) ||
                (supplyArea && s.type === 'supplyarea' && s.id === supplyArea.id)
                ))
            .map(v => v.text);
    }

    public getStateWarnings(state: State, supplyArea?: SupplyArea): string[] {
        return this.warnings
            .filter(v => v.source.some(s =>
                (s.type === 'state' && s.id === state.id) ||
                (supplyArea && s.type === 'supplyarea' && s.id === supplyArea.id)
                ))
            .map(v => v.text);
    }

    public getStrategicRegionWarnings(strategicRegion: StrategicRegion): string[] {
        return this.warnings.filter(v => v.source.some(s => s.type === 'strategicregion' && s.id === strategicRegion.id)).map(v => v.text);
    }
    
    public getSupplyAreaWarnings(supplyArea: SupplyArea): string[] {
        return this.warnings.filter(v => v.source.some(s => s.type === 'supplyarea' && s.id === supplyArea.id)).map(v => v.text);
    }

    public getRiverWarnings(riverIndex: number): string[] {
        return this.warnings.filter(v => v.source.some(s => s.type === 'river' && s.index === riverIndex)).map(v => v.text);
    }
}
