import { Subscriber, toBehaviorSubject } from "../util/event";
import { Loader, FEWorldMap } from "./loader";
import { ViewPoint } from "./viewpoint";
import { vscode } from "../util/vscode";
import { MoveProvinceItem, WorldMapMessage, WorldMapWarning } from "../../src/previewdef/worldmap/definitions";
import { feLocalize } from "../util/i18n";
import { DivDropdown } from "../util/dropdown";
import { BehaviorSubject, combineLatest, fromEvent } from 'rxjs';
import { Renderer } from './renderer';
import { sendEvent } from '../util/telemetry';
import { applyCondition, ConditionItem, stringValueToConditionItem } from "../../src/hoiformat/condition";
import { buildWorldMapConditionOptions } from "./conditionoptions";
import { nextBehaviorSubjectIfChanged } from './subject';

export type ViewMode = 'province' | 'state' | 'country' | 'strategicregion' | 'warnings';
export type ColorSet = 'provinceid' | 'provincetype' | 'terrain' | 'owner' | 'controller' | 'stateid' | 'manpower' |
    'victorypoint' | 'continent' | 'warnings' | 'strategicregionid' | 'resources' | 'localsupplies' | 'statecategory';

export const topBarHeight = 40;

export class TopBar extends Subscriber {
    public viewMode$: BehaviorSubject<ViewMode>;
    public colorSet$: BehaviorSubject<ColorSet>;
    public hoverProvinceId$: BehaviorSubject<number | undefined>;
    public selectedProvinceId$: BehaviorSubject<number | undefined>;
    public hoverStateId$: BehaviorSubject<number | undefined>;
    public selectedStateId$: BehaviorSubject<number | undefined>;
    public hoverCountryTag$: BehaviorSubject<string | undefined>;
    public selectedCountryTag$: BehaviorSubject<string | undefined>;
    public hoverStrategicRegionId$: BehaviorSubject<number | undefined>;
    public selectedStrategicRegionId$: BehaviorSubject<number | undefined>;
    public selectedConditions$: BehaviorSubject<ConditionItem[]>;
    public warningFilter: DivDropdown;
    public display: DivDropdown;
    public conditions: DivDropdown;

    public editMode: boolean = false;
    public linkStateStrategicRegion: boolean = true;

    private searchBox: HTMLInputElement;

    constructor(private readonly canvas: HTMLCanvasElement, private viewPoint: ViewPoint, private loader: Loader, state: any) {
        super();

        this.addSubscription(this.warningFilter = new DivDropdown(document.getElementById('warningfilter') as HTMLDivElement, true));
        this.addSubscription(this.display = new DivDropdown(document.getElementById('display') as HTMLDivElement, true));
        this.addSubscription(this.conditions = new DivDropdown(document.getElementById('conditions') as HTMLDivElement, true));

        this.viewMode$ = toBehaviorSubject(document.getElementById('viewmode') as HTMLSelectElement, state.viewMode ?? 'province');
        const initialColorSet = state.colorSet === 'country' ? 'owner' : state.colorSet ?? 'provinceid';
        this.colorSet$ = toBehaviorSubject(document.getElementById('colorset') as HTMLSelectElement, initialColorSet);
        this.hoverProvinceId$ = new BehaviorSubject<number | undefined>(undefined);
        this.selectedProvinceId$ = new BehaviorSubject<number | undefined>(state.selectedProvinceId ?? undefined);
        this.hoverStateId$ = new BehaviorSubject<number | undefined>(undefined);
        this.selectedStateId$ = new BehaviorSubject<number | undefined>(state.selectedStateId ?? undefined);
        this.hoverCountryTag$ = new BehaviorSubject<string | undefined>(undefined);
        this.selectedCountryTag$ = new BehaviorSubject<string | undefined>(state.selectedCountryTag ?? undefined);
        this.hoverStrategicRegionId$ = new BehaviorSubject<number | undefined>(undefined);
        this.selectedStrategicRegionId$ = new BehaviorSubject<number | undefined>(state.selectedStrategicRegionId ?? undefined);
        const selectedConditionValues: string[] = Array.isArray(state.selectedConditions) ? state.selectedConditions : [];
        this.selectedConditions$ = new BehaviorSubject<ConditionItem[]>(selectedConditionValues.map(stringValueToConditionItem));
        this.conditions.selectedValues$.next(selectedConditionValues);
        this.addSubscription(this.conditions.selectedValues$.subscribe(selection => {
            this.selectedConditions$.next(selection.map(stringValueToConditionItem));
        }));
        this.addSubscription(loader.worldMap$.subscribe(this.setupConditions));
        if (state.warningFilter) {
            this.warningFilter.selectedValues$.next(state.warningFilter);
        } else {
            this.warningFilter.selectAll();
        }
        if (state.display) {
            this.display.selectedValues$.next(state.display);
        } else {
            this.display.selectAll();
        }

        this.searchBox = document.getElementById("searchbox") as HTMLInputElement;

        this.loadControls();
        this.registerEventListeners(canvas);
    }

    public override dispose(): void {
        super.dispose();
        this.viewMode$.complete();
        this.colorSet$.complete();
        this.hoverProvinceId$.complete();
        this.selectedProvinceId$.complete();
        this.hoverStateId$.complete();
        this.selectedStateId$.complete();
        this.hoverCountryTag$.complete();
        this.selectedCountryTag$.complete();
        this.hoverStrategicRegionId$.complete();
        this.selectedStrategicRegionId$.complete();
        this.selectedConditions$.complete();
    }

    private setupConditions = (worldMap: FEWorldMap) => {
        const options = buildWorldMapConditionOptions(worldMap);
        if (!options) {
            return;
        }

        const optionValues = new Set(options.map(option => option.value));
        const selectedConditions = this.conditions.selectedValues$.value.filter(value => optionValues.has(value));
        this.conditions.setupOptions(options);
        this.conditions.selectedValues$.next(selectedConditions);
        const group = this.conditions.select.closest('.group') as HTMLElement | null;
        if (group) {
            group.hidden = options.length === 0;
        }
    };

    private onViewModeChange() {
        document.querySelectorAll('#colorset > option[viewmode]').forEach(v => {
            (v as HTMLOptionElement).hidden = true;
        });
    
        let colorSetHidden = true;
        document.querySelectorAll('#colorset > option[viewmode~="' + this.viewMode$.value + '"]').forEach(v => {
            (v as HTMLOptionElement).hidden = false;
            if ((v as HTMLOptionElement).value === this.colorSet$.value) {
                colorSetHidden = false;
            }
        });
        
        document.querySelectorAll('#colorset > option:not([viewmode])').forEach(v => {
            if ((v as HTMLOptionElement).value === this.colorSet$.value) {
                colorSetHidden = false;
            }
        });

        document.querySelectorAll('button[viewmode]').forEach(v => {
            (v as HTMLButtonElement).style.display = 'none';
        });

        document.querySelectorAll('button[viewmode~="' + this.viewMode$.value + '"]').forEach(v => {
            (v as HTMLButtonElement).style.display = 'inline-block';
        });

        document.querySelectorAll('.group[viewmode]').forEach(v => {
            (v as HTMLDivElement).style.display = 'none';
        });

        document.querySelectorAll('.group[viewmode~="' + this.viewMode$.value + '"]').forEach(v => {
            (v as HTMLDivElement).style.display = 'inline-block';
        });
    
        if (colorSetHidden) {
            const newColorset = (document.querySelector('#colorset > option:not(*[hidden])') as HTMLOptionElement)?.value;
            this.colorSet$.next(newColorset as any);
        }

        this.setSearchBoxPlaceHolder();
    }
    
    private loadControls() {
        this.loadWarningButton();
        this.loadSearchBox();
        this.loadRefreshButton();
        this.loadOpenButton();
        this.loadExportButton();
        this.loadEditControls();
    }

    private loadWarningButton() {
        const warningsContainer = document.getElementById('warnings-container')!;
        const showWarnings = document.getElementById('show-warnings')!;
        this.addSubscription(fromEvent(showWarnings, 'click').subscribe(() => {
            showWarnings.classList.toggle('active');
            if (showWarnings.classList.contains('active')) {
                sendEvent('worldmap.openwarnings');
                warningsContainer.style.display = 'block';
            } else {
                warningsContainer.style.display = 'none';
            }
        }));
    }

    private loadSearchBox() {
        const searchBox = this.searchBox;
        const search = document.getElementById("search")!;
        this.addSubscription(fromEvent<KeyboardEvent>(searchBox, 'keypress').subscribe((e) => {
            if (e.code === 'Enter') {
                sendEvent('worldmap.search', { keypress: 'true' });
                this.search(searchBox.value);
            }
        }));
        this.addSubscription(fromEvent(search, 'click').subscribe(() => {
            sendEvent('worldmap.search', { keypress: 'false' });
            this.search(searchBox.value);
        }));
    }

    private loadRefreshButton() {
        const refresh = document.getElementById("refresh") as HTMLButtonElement;
        this.addSubscription(fromEvent(refresh, 'click').subscribe(() => {
            if (!refresh.disabled) {
                sendEvent('worldmap.refresh');
                this.loader.refresh();
            }
        }));
        this.addSubscription(this.loader.loading$.subscribe(v => {
            refresh.disabled = v;
        }));
    }

    private openMapItem(useHoverValue = false) {
        sendEvent('worldmap.open.' + this.viewMode$.value + (useHoverValue ? '.dblclick' : ''));
        if (this.viewMode$.value === 'province') {
            const provinceId = useHoverValue ? this.hoverProvinceId$.value : this.selectedProvinceId$.value;
            const province = this.loader.worldMap.getProvinceById(provinceId);
            const definitionsFile = this.loader.worldMap.provinceDefinitionsFile;
            if (province && definitionsFile && province.lineNumber !== undefined) {
                vscode.postMessage<WorldMapMessage>({
                    command: 'openfile',
                    type: 'provincedefinition',
                    file: definitionsFile,
                    start: undefined,
                    end: undefined,
                    lineNumber: province.lineNumber,
                });
            }
        } else if (this.viewMode$.value === 'state') {
            const selected = useHoverValue ? this.hoverStateId$.value : this.selectedStateId$.value;
            if (selected) {
                const state = this.loader.worldMap.getStateById(selected);
                if (state) {
                    vscode.postMessage<WorldMapMessage>({ command: 'openfile', type: 'state', file: state.file, start: state.token?.start, end: state.token?.end });
                }
            }
        } else if (this.viewMode$.value === 'country') {
            const selected = useHoverValue ? this.hoverCountryTag$.value : this.selectedCountryTag$.value;
            const country = this.loader.worldMap.getCountryByTag(selected);
            if (country) {
                vscode.postMessage<WorldMapMessage>({ command: 'openfile', type: 'country', file: country.file, start: 0, end: 0 });
            }
        } else if (this.viewMode$.value === 'strategicregion') {
            const selected = useHoverValue ? this.hoverStrategicRegionId$.value : this.selectedStrategicRegionId$.value;
            if (selected) {
                const strategicRegion = this.loader.worldMap.getStrategicRegionById(selected);
                if (strategicRegion) {
                    vscode.postMessage<WorldMapMessage>({ command: 'openfile', type: 'strategicregion', file: strategicRegion.file,
                        start: strategicRegion.token?.start, end: strategicRegion.token?.end });
                }
            }
        }
    }

    private loadOpenButton() {
        const open = document.getElementById("open") as HTMLButtonElement;
        this.addSubscription(fromEvent(open, 'click').subscribe((e) => {
            e.stopPropagation();
            this.openMapItem();
        }));

        this.addSubscription(combineLatest([this.viewMode$, this.selectedProvinceId$, this.selectedStateId$, this.selectedCountryTag$, this.selectedStrategicRegionId$]).subscribe(
            ([viewMode, selectedProvinceId, selectedStateId, selectedCountryTag, selectedStrategicRegionId]) => {
                open.disabled = !((viewMode === 'province' && selectedProvinceId !== undefined &&
                        this.loader.worldMap.getProvinceById(selectedProvinceId)?.lineNumber !== undefined) ||
                    (viewMode === 'state' && selectedStateId !== undefined) ||
                    (viewMode === 'country' && selectedCountryTag !== undefined) ||
                    (viewMode === 'strategicregion' && selectedStrategicRegionId !== undefined));
            }
        ));
    }

    private loadExportButton() {
        const exportButton = document.getElementById("export") as HTMLButtonElement;
        exportButton.disabled = true;
        this.addSubscription(this.loader.worldMap$.subscribe(wm => {
            exportButton.disabled = !wm;
        }));
        this.addSubscription(fromEvent(exportButton, 'click').subscribe(e => {
            e.stopPropagation();
            vscode.postMessage({ command: 'requestexportmap' });
        }));
        this.addSubscription(fromEvent<MessageEvent>(window, 'message').subscribe(event => {
            const message = event.data as WorldMapMessage;
            if (message.command !== 'requestexportmap') {
                return;
            }

            const worldMap = this.loader.worldMap;
            if (!worldMap) {
                return;
            }

            sendEvent('worldmap.export');
            const scale = message.scale ?? 1;
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, worldMap.width * scale);
            canvas.height = Math.max(1, worldMap.height * scale);
            const viewPoint = new ViewPoint(canvas, this.loader, 0, { x: 0, y: 0, scale });
            try {
                Renderer.renderMapImpl(canvas, this, viewPoint, worldMap, { preciseEdge: true, overwriteRenderPrecision: 1 });
                vscode.postMessage({ command: 'exportmap', dataUrl: canvas.toDataURL() });
            } finally {
                viewPoint.dispose();
            }
        }));
    }

    private loadEditControls() {
        const edit = document.getElementById('edit') as HTMLButtonElement;
        const link = document.getElementById('link-state-strategicregion') as HTMLButtonElement;
        const add = document.getElementById('add') as HTMLButtonElement;
        link.classList.add('active');
        const toggleEdit = () => {
            if (edit.disabled) {
                return;
            }
            this.editMode = !this.editMode;
            edit.classList.toggle('active', this.editMode);
            this.canvasCursor(this.editMode);
        };
        const toggleLink = () => {
            this.linkStateStrategicRegion = !this.linkStateStrategicRegion;
            link.classList.toggle('active', this.linkStateStrategicRegion);
        };
        const addMapItem = () => {
            if (this.viewMode$.value === 'state' || this.viewMode$.value === 'strategicregion') {
                vscode.postMessage<WorldMapMessage>({ command: 'addmapitem', type: this.viewMode$.value });
            }
        };
        this.addSubscription(fromEvent(edit, 'click').subscribe(event => {
            event.stopPropagation();
            toggleEdit();
        }));
        this.addSubscription(fromEvent(link, 'click').subscribe(event => {
            event.stopPropagation();
            toggleLink();
        }));
        this.addSubscription(fromEvent(add, 'click').subscribe(event => {
            event.stopPropagation();
            addMapItem();
        }));
        this.addSubscription(combineLatest([this.viewMode$, this.selectedStateId$, this.selectedStrategicRegionId$]).subscribe(
            ([viewMode, stateId, strategicRegionId]) => {
                edit.disabled = !((viewMode === 'state' && stateId !== undefined) ||
                    (viewMode === 'strategicregion' && strategicRegionId !== undefined));
                if (edit.disabled && this.editMode) {
                    this.editMode = false;
                    edit.classList.remove('active');
                    this.canvasCursor(false);
                }
            },
        ));
        this.addSubscription(fromEvent<KeyboardEvent>(window, 'keydown').subscribe(event => {
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
                return;
            }
            if (event.code === 'KeyE') {
                toggleEdit();
            } else if (event.code === 'KeyS') {
                toggleLink();
            } else if (event.code === 'KeyA') {
                addMapItem();
            }
        }));
        this.addSubscription(fromEvent<MessageEvent>(window, 'message').subscribe(event => {
            const message = event.data as WorldMapMessage;
            if (message.command !== 'selectmapitem') {
                return;
            }
            if (message.type === 'state') {
                this.viewMode$.next('state');
                this.selectedStateId$.next(message.id);
            } else {
                this.viewMode$.next('strategicregion');
                this.selectedStrategicRegionId$.next(message.id);
            }
            if (message.enterEditMode && !this.editMode) {
                this.editMode = true;
                edit.classList.add('active');
                this.canvasCursor(true);
            }
        }));
    }

    private canvasCursor(editing: boolean): void {
        this.canvas.style.cursor = editing ? 'cell' : 'crosshair';
    }
    
    private registerEventListeners(canvas: HTMLCanvasElement) {
        this.addSubscription(fromEvent<MouseEvent>(canvas, 'mousemove').subscribe((e) => {
            if (!this.loader.worldMap) {
                nextBehaviorSubjectIfChanged(this.hoverProvinceId$, undefined);
                nextBehaviorSubjectIfChanged(this.hoverStateId$, undefined);
                nextBehaviorSubjectIfChanged(this.hoverCountryTag$, undefined);
                nextBehaviorSubjectIfChanged(this.hoverStrategicRegionId$, undefined);
                return;
            }
    
            const worldMap = this.loader.worldMap;
            let x = this.viewPoint.convertBackX(e.pageX);
            const y = this.viewPoint.convertBackY(e.pageY);
            if (worldMap.width > 0) {
                x = (x % worldMap.width + worldMap.width) % worldMap.width;
            }

            const provinceId = worldMap.getProvinceByPosition(x, y)?.id;
            const stateId = provinceId === undefined ? undefined : worldMap.getStateByProvinceId(provinceId)?.id;
            const state = worldMap.getStateById(stateId);
            const countryTag = state?.owner.find(owner => applyCondition(owner.condition, this.selectedConditions$.value))?.value;
            const strategicRegionId = provinceId === undefined ? undefined : worldMap.getStrategicRegionByProvinceId(provinceId)?.id;
            nextBehaviorSubjectIfChanged(this.hoverProvinceId$, provinceId);
            nextBehaviorSubjectIfChanged(this.hoverStateId$, stateId);
            nextBehaviorSubjectIfChanged(this.hoverCountryTag$, countryTag);
            nextBehaviorSubjectIfChanged(this.hoverStrategicRegionId$, strategicRegionId);
        }));
    
        this.addSubscription(fromEvent(canvas, 'mouseleave').subscribe(() => {
            nextBehaviorSubjectIfChanged(this.hoverProvinceId$, undefined);
            nextBehaviorSubjectIfChanged(this.hoverStateId$, undefined);
            nextBehaviorSubjectIfChanged(this.hoverCountryTag$, undefined);
            nextBehaviorSubjectIfChanged(this.hoverStrategicRegionId$, undefined);
        }));
    
        this.addSubscription(fromEvent(canvas, 'click').subscribe(() => {
            if (this.editMode && this.moveHoveredProvince()) {
                return;
            }
            switch (this.viewMode$.value) {
                case 'province':
                    this.selectedProvinceId$.next(this.selectedProvinceId$.value === this.hoverProvinceId$.value ? undefined : this.hoverProvinceId$.value);
                    break;
                case 'state':
                    this.selectedStateId$.next(this.selectedStateId$.value === this.hoverStateId$.value ? undefined : this.hoverStateId$.value);
                    break;
                case 'country':
                    this.selectedCountryTag$.next(this.selectedCountryTag$.value === this.hoverCountryTag$.value ? undefined : this.hoverCountryTag$.value);
                    break;
                case 'strategicregion':
                    this.selectedStrategicRegionId$.next(this.selectedStrategicRegionId$.value === this.hoverStrategicRegionId$.value ? undefined : this.hoverStrategicRegionId$.value);
                    break;
            }
        }));

        this.addSubscription(fromEvent(canvas, 'dblclick').subscribe(e => {
            e.stopPropagation();
            if (this.editMode) {
                return;
            }
            this.openMapItem(true);
        }));

        this.addSubscription(this.viewMode$.subscribe(() => this.onViewModeChange()));

        this.addSubscription(this.loader.worldMap$.subscribe(wm => {
            const warnings = document.getElementById('warnings') as HTMLTextAreaElement;
            if (wm.warnings.length === 0) {
                warnings.value = feLocalize('worldmap.warnings.nowarnings', 'No warnings.');
            } else {
                warnings.value = feLocalize('worldmap.warnings', 'World map warnings: \n\n{0}', wm.warnings.map(warningToString).join('\n'));
            }

            this.setSearchBoxPlaceHolder(wm);
        }));
    }

    private moveHoveredProvince(): boolean {
        const provinceId = this.hoverProvinceId$.value;
        if (provinceId === undefined) {
            return false;
        }
        const worldMap = this.loader.worldMap;
        if (this.viewMode$.value === 'state') {
            const target = worldMap.getStateById(this.selectedStateId$.value);
            if (!target) {
                return false;
            }
            const source = worldMap.getStateByProvinceId(provinceId);
            const items: MoveProvinceItem[] = [{
                type: 'state',
                provinces: [provinceId],
                to: target.id,
                from: source?.id,
                toFile: target.file,
                fromFile: source?.file,
            }];
            if (this.linkStateStrategicRegion && source !== target) {
                const targetStrategicRegion = target.provinces.map(id => worldMap.getStrategicRegionByProvinceId(id)).find(Boolean);
                const sourceStrategicRegion = worldMap.getStrategicRegionByProvinceId(provinceId);
                if (targetStrategicRegion && targetStrategicRegion !== sourceStrategicRegion) {
                    items.push({
                        type: 'strategicregion',
                        provinces: [provinceId],
                        to: targetStrategicRegion.id,
                        from: sourceStrategicRegion?.id,
                        toFile: targetStrategicRegion.file,
                        fromFile: sourceStrategicRegion?.file,
                    });
                }
            }
            vscode.postMessage<WorldMapMessage>({ command: 'moveprovince', items });
            return true;
        }
        if (this.viewMode$.value === 'strategicregion') {
            const target = worldMap.getStrategicRegionById(this.selectedStrategicRegionId$.value);
            if (!target) {
                return false;
            }
            const source = worldMap.getStrategicRegionByProvinceId(provinceId);
            vscode.postMessage<WorldMapMessage>({
                command: 'moveprovince',
                items: [{
                    type: 'strategicregion',
                    provinces: [provinceId],
                    to: target.id,
                    from: source?.id,
                    toFile: target.file,
                    fromFile: source?.file,
                }],
            });
            return true;
        }
        return false;
    }

    private search(text: string) {
        const number = parseInt(text);
        if (isNaN(number)) {
            return;
        }

        const viewMode = this.viewMode$.value;
        const [getRegionById, selectedId] =
            viewMode === 'province' ? [this.loader.worldMap.getProvinceById, this.selectedProvinceId$] :
            viewMode === 'state' ? [this.loader.worldMap.getStateById, this.selectedStateId$] :
            viewMode === 'strategicregion' ? [this.loader.worldMap.getStrategicRegionById, this.selectedStrategicRegionId$] :
            [() => undefined, undefined];
            
        const region = getRegionById(number);
        if (region) {
            selectedId?.next(number);
            this.viewPoint.centerZone(region.boundingBox);
        }
    }

    private setSearchBoxPlaceHolder(worldMap?: FEWorldMap) {
        if (!worldMap) {
            worldMap = this.loader.worldMap;
        }

        let placeholder = '';
        switch (this.viewMode$.value) {
            case 'province':
                placeholder = worldMap.provincesCount > 1 ? `1-${worldMap.provincesCount - 1}` : '';
                break;
            case 'state':
                placeholder = worldMap.statesCount > 1 ? `1-${worldMap.statesCount - 1}` : '';
                break;
            case 'strategicregion':
                placeholder = worldMap.strategicRegionsCount > 1 ? `1-${worldMap.strategicRegionsCount - 1}` : '';
                break;
            default:
                break;
        }

        if (placeholder) {
            this.searchBox.placeholder = feLocalize('worldmap.topbar.search.placeholder', 'Range: {0}', placeholder);
        } else {
            this.searchBox.placeholder = '';
        }
    }
}

function warningToString(warning: WorldMapWarning): string {
    return `[${warning.source.map(s => `${s.type[0].toUpperCase()}${s.type.substr(1)} ${'id' in s ? s.id : s.name}`).join(', ')}] ${warning.text}`;
}
