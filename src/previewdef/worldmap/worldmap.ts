import * as vscode from 'vscode';
import worldmapview from './worldmapview.html';
import worldmapviewstyles from './worldmapview.css';
import { localize, localizeText, i18nTableAsScript } from '../../util/i18n';
import { html } from '../../util/html';
import { error, debug } from '../../util/debug';
import { WorldMapMessage, WorldMapData, MapItemMessage, RequestMapItemMessage } from './definitions';
import { matchPathEnd } from '../../util/nodecommon';
import { writeFile, mkdirs, getDocumentByUri, dirUri } from '../../util/vsccommon';
import { slice, forceError } from '../../util/common';
import { getFilePathFromMod, getHoiOpenedFileOriginalUri, readFileFromModOrHOI4 } from '../../util/fileloader';
import { WorldMapLoader } from './loader/worldmaploader';
import { LoaderSession } from '../../util/loader/loader';
import { TelemetryMessage, sendByMessage } from '../../util/telemetry';
import { areEqualWithinBudget, createWorldMapComparisonBudget, WorldMapComparisonBudget } from './worldmapdiff';
import { getPerfSnapshot, measureAsync, recordPerf } from '../../util/perf';
import { debounce } from 'lodash';
import { createWorldMapSummary, getWorldMapMessageMetrics, resolveWorldMapRequest } from './worldmappayload';
import { WorldMapLoadQueue, WorldMapLoadRequest } from './worldmaploadqueue';

export class WorldMap {
    public panel: vscode.WebviewPanel | undefined;

    private worldMapLoader: WorldMapLoader;
    private worldMapDependencies: string[] | undefined;
    private cachedWorldMap: WorldMapData | undefined;
    private committedWorldMap: WorldMapData | undefined;
    private pendingWorldMap: { loadGeneration: number; worldMap: WorldMapData } | undefined;
    private loadGeneration = 0;
    private progressLoadGeneration = 0;
    private loaderProgressGenerations = new WeakMap<WorldMapLoader, number>();
    private readonly loadQueue: WorldMapLoadQueue;

    private lastRequestedExportUri: vscode.Uri | undefined;

    constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;
        this.worldMapLoader = this.createWorldMapLoader();
        this.loadQueue = new WorldMapLoadQueue(request => this.loadWorldMapGeneration(request));
    }

    public initialize(): void {
        if (!this.panel) {
            return;
        }

        const webview = this.panel.webview;
        webview.html = this.renderWorldMap(webview);
        webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    }

    private readonly reloadChangedDependencies = debounce(() => {
        this.worldMapLoader.shallowForceReload();
        void this.sendProvinceMapSummaryToWebview(false);
    }, 1000, { trailing: true });

    public onDocumentChange = (uri: vscode.Uri): void => {
        if (this.worldMapDependencies?.some(dependency => matchPathEnd(uri.toString(), dependency.split('/')))) {
            this.reloadChangedDependencies();
        }
    };

    public dispose() {
        this.loadGeneration++;
        this.progressLoadGeneration = this.loadGeneration;
        this.loadQueue.clearPending();
        this.reloadChangedDependencies.cancel();
        this.worldMapLoader.clearCache();
        this.worldMapDependencies = undefined;
        this.cachedWorldMap = undefined;
        this.committedWorldMap = undefined;
        this.pendingWorldMap = undefined;
        this.panel = undefined;
    }

    public getDebugState(): unknown {
        const cachedWorldMap = this.cachedWorldMap;
        return {
            hasPanel: !!this.panel,
            loadGeneration: this.loadGeneration,
            progressLoadGeneration: this.progressLoadGeneration,
            loadInProgress: this.loadQueue.isRunning,
            hasCommittedWorldMap: this.committedWorldMap !== undefined,
            pendingWorldMapGeneration: this.pendingWorldMap?.loadGeneration,
            dependencyCount: this.worldMapDependencies?.length ?? 0,
            cachedWorldMap: cachedWorldMap ? {
                width: cachedWorldMap.width,
                height: cachedWorldMap.height,
                provincesCount: cachedWorldMap.provincesCount,
                statesCount: cachedWorldMap.statesCount,
                countriesCount: cachedWorldMap.countriesCount,
                strategicRegionsCount: cachedWorldMap.strategicRegionsCount,
                supplyAreasCount: cachedWorldMap.supplyAreasCount,
                railwaysCount: cachedWorldMap.railwaysCount,
                supplyNodesCount: cachedWorldMap.supplyNodesCount,
                warningCount: cachedWorldMap.warnings.length,
                retainedJsonBytes: getMessageSize(cachedWorldMap),
            } : undefined,
            performance: getPerfSnapshot({ limit: 25 }),
        };
    }

    private renderWorldMap(webview: vscode.Webview): string {
        return html(
            webview,
            localizeText(worldmapview),
            [
                { content: i18nTableAsScript() },
                'worldmap.js'
            ],
            ['common.css', 'codicon.css', { content: worldmapviewstyles }]
        );
    }

    private async onMessage(msg: WorldMapMessage | TelemetryMessage): Promise<void> {
        try {
            debug('worldmap message ' + JSON.stringify(msg));
            switch (msg.command) {
                case 'loaded':
                    await this.sendProvinceMapSummaryToWebview(msg.force);
                    break;
                case 'mapready':
                    this.commitPendingWorldMap(msg.loadGeneration);
                    break;
                case 'requestprovinces':
                case 'requeststates':
                case 'requestcountries':
                case 'requeststrategicregions':
                case 'requestsupplyareas':
                case 'requestrailways':
                case 'requestsupplynodes':
                    if (!this.isCurrentLoadGeneration(msg.loadGeneration)) {
                        break;
                    }
                    await this.sendRequestedMapData(msg);
                    break;
                case 'openfile':
                    await this.openFile(msg.file, msg.type, msg.start, msg.end);
                    break;
                case 'telemetry':
                    await sendByMessage(msg);
                    break;
                case 'requestexportmap':
                    await this.requestExportMap();
                    break;
                case 'exportmap':
                    await this.exportMap(msg.dataUrl);
                    break;
            }
        } catch (e) {
            error(e);
        }
    }

    private sendRequestedMapData(msg: RequestMapItemMessage) {
        const worldMap = this.cachedWorldMap;
        if (!worldMap || !this.isCurrentLoadGeneration(msg.loadGeneration)) {
            return false;
        }

        const { command, value } = resolveWorldMapRequest(worldMap, msg);

        return this.postMessageToWebview({
            command: command,
            data: slice(value, msg.start, msg.end),
            start: msg.start,
            end: msg.end,
            loadGeneration: msg.loadGeneration,
        } as WorldMapMessage);
    }

    private createWorldMapLoader(): WorldMapLoader {
        const loader = new WorldMapLoader();
        loader.onProgress(async progress => {
            const loadGeneration = this.loaderProgressGenerations.get(loader) ?? 0;
            if (!this.isCurrentLoadGeneration(loadGeneration)) {
                return;
            }

            debug('Progress:', progress);
            await this.postMessageToWebview({
                command: 'progress',
                data: progress,
                loadGeneration,
            } as WorldMapMessage);
        });
        return loader;
    }

    private async sendProvinceMapSummaryToWebview(force: boolean) {
        const loadGeneration = ++this.loadGeneration;
        this.progressLoadGeneration = loadGeneration;
        await this.loadQueue.enqueue({ loadGeneration, force });
    }

    private async loadWorldMapGeneration({ loadGeneration, force }: WorldMapLoadRequest): Promise<void> {
        const worldMapLoader = this.worldMapLoader;
        this.loaderProgressGenerations.set(worldMapLoader, loadGeneration);
        if (force) {
            worldMapLoader.clearCache();
        }

        try {
            const committedWorldMap = this.pendingWorldMap ? undefined : this.committedWorldMap;
            const loaderSession = new LoaderSession(force, () => this.panel === undefined || !this.isCurrentLoadGeneration(loadGeneration));
            const { result: worldMap, dependencies } = await measureAsync('worldmap.load', { force }, () =>
                worldMapLoader.load(loaderSession));
            if (!this.isCurrentLoadGeneration(loadGeneration)) {
                return;
            }

            this.worldMapDependencies = dependencies;
            this.cachedWorldMap = worldMap;

            if (!force && committedWorldMap) {
                const sentDifferences = await measureAsync('worldmap.diff', {}, () =>
                    this.sendDifferences(committedWorldMap, worldMap, loadGeneration));
                if (sentDifferences) {
                    return;
                }
            }

            if (!this.isCurrentLoadGeneration(loadGeneration)) {
                return;
            }

            this.pendingWorldMap = { loadGeneration, worldMap };
            await this.postMessageToWebview({
                command: 'provincemapsummary',
                data: createWorldMapSummary(worldMap),
                loadGeneration,
            } as WorldMapMessage);
        } catch (e) {
            if (!this.isCurrentLoadGeneration(loadGeneration)) {
                return;
            }

            error(e);

            await this.postMessageToWebview({
                command: 'error',
                data: localize('worldmap.failedtoload', 'Failed to load world map: {0}.', forceError(e).toString()),
                loadGeneration,
            } as WorldMapMessage);
        }
    }

    private async openFile(file: string, type: 'state' | 'strategicregion' | 'supplyarea', start: number | undefined, end: number | undefined): Promise<void> {
        // TODO duplicate with previewbase.ts
        const filePathInMod = await getFilePathFromMod(file);
        if (filePathInMod !== undefined) {
            const filePathInModWithoutOpened = getHoiOpenedFileOriginalUri(filePathInMod);
            const document = getDocumentByUri(filePathInModWithoutOpened) ?? await vscode.workspace.openTextDocument(filePathInModWithoutOpened);
            await vscode.window.showTextDocument(document, {
                selection: start !== undefined && end !== undefined ? new vscode.Range(document.positionAt(start), document.positionAt(end)) : undefined,
            });
            return;
        }

        const typeName = localize('worldmap.openfiletype.' + type as any, type);
        
        if (!vscode.workspace.workspaceFolders?.length) {
            await vscode.window.showErrorMessage(localize('worldmap.mustopenafolder', 'Must open a folder before opening {0} file.', typeName));
            return;
        }

        let targetFolderUri = vscode.workspace.workspaceFolders[0].uri;
        if (vscode.workspace.workspaceFolders.length > 1) {
            const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: localize('worldmap.selectafolder', 'Select a folder to copy {0} file', typeName) });
            if (!folder) {
                return;
            }

            targetFolderUri = folder.uri;
        }

        try {
            const [buffer] = await readFileFromModOrHOI4(file);
            const targetPath = vscode.Uri.joinPath(targetFolderUri, file);
            await mkdirs(dirUri(targetPath));
            await writeFile(targetPath, buffer);

            const document = await vscode.workspace.openTextDocument(targetPath);
            await vscode.window.showTextDocument(document, {
                selection: start !== undefined && end !== undefined ? new vscode.Range(document.positionAt(start), document.positionAt(end)) : undefined,
            });

        } catch (e) {
            await vscode.window.showErrorMessage(localize('worldmap.failedtoopenstate', 'Failed to open {0} file: {1}.', typeName, forceError(e).toString()));
        }
    }

    private async sendDifferences(cachedWorldMap: WorldMapData, worldMap: WorldMapData, loadGeneration: number): Promise<boolean> {
        await this.postProgress(localize('worldmap.progress.comparing', 'Comparing changes...'), loadGeneration);
        if (!this.isCurrentLoadGeneration(loadGeneration)) {
            return true;
        }
        const changeMessages: WorldMapMessage[] = [];
        const comparisonBudget = createWorldMapComparisonBudget();

        for (const key of ['width', 'height', 'provincesCount', 'statesCount', 'countriesCount', 'strategicRegionsCount', 'supplyAreasCount',
            'railwaysCount', 'supplyNodesCount',
            'badProvincesCount', 'badStatesCount', 'badStrategicRegionsCount', 'badSupplyAreasCount'] as (keyof WorldMapData)[]) {
            const equal = areEqualWithinBudget(cachedWorldMap[key], worldMap[key], comparisonBudget);
            if (equal !== true) {
                return false;
            }
        }

        const warningsEqual = areEqualWithinBudget(cachedWorldMap.warnings, worldMap.warnings, comparisonBudget);
        if (warningsEqual === undefined) {
            return false;
        }
        if (!warningsEqual) {
            changeMessages.push({ command: 'warnings', data: worldMap.warnings, start: 0, end: 0 });
        }

        const continentsEqual = areEqualWithinBudget(cachedWorldMap.continents, worldMap.continents, comparisonBudget);
        if (continentsEqual === undefined) {
            return false;
        }
        if (!continentsEqual) {
            changeMessages.push({ command: 'continents', data: worldMap.continents, start: 0, end: 0 });
        }

        const terrainsEqual = areEqualWithinBudget(cachedWorldMap.terrains, worldMap.terrains, comparisonBudget);
        if (terrainsEqual === undefined) {
            return false;
        }
        if (!terrainsEqual) {
            changeMessages.push({ command: 'terrains', data: worldMap.terrains, start: 0, end: 0 });
        }

        const resourcesEqual = areEqualWithinBudget(cachedWorldMap.resources, worldMap.resources, comparisonBudget);
        if (resourcesEqual === undefined) {
            return false;
        }
        if (!resourcesEqual) {
            changeMessages.push({ command: 'resources', data: worldMap.resources, start: 0, end: 0 });
        }

        const riversEqual = areEqualWithinBudget(cachedWorldMap.rivers, worldMap.rivers, comparisonBudget);
        if (riversEqual === undefined) {
            return false;
        }
        if (!riversEqual) {
            changeMessages.push({ command: 'rivers', data: worldMap.rivers, start: 0, end: 0 });
        }

        const conditionExprsEqual = areEqualWithinBudget(cachedWorldMap.conditionExprs, worldMap.conditionExprs, comparisonBudget);
        if (conditionExprsEqual === undefined) {
            return false;
        }
        if (!conditionExprsEqual) {
            changeMessages.push({ command: 'conditionexprs', data: worldMap.conditionExprs, start: 0, end: 0 });
        }

        const bookmarksEqual = areEqualWithinBudget(cachedWorldMap.bookmarks, worldMap.bookmarks, comparisonBudget);
        if (bookmarksEqual === undefined) {
            return false;
        }
        if (!bookmarksEqual) {
            changeMessages.push({ command: 'bookmarks', data: worldMap.bookmarks, start: 0, end: 0 });
        }

        if (!this.fillMessageForItem(changeMessages, worldMap.provinces, cachedWorldMap.provinces, 'provinces', worldMap.badProvincesCount, worldMap.provincesCount, comparisonBudget)) {
            return false;
        }

        if (!this.fillMessageForItem(changeMessages, worldMap.states, cachedWorldMap.states, 'states', worldMap.badStatesCount, worldMap.statesCount, comparisonBudget)) {
            return false;
        }

        if (!this.fillMessageForItem(changeMessages, worldMap.countries, cachedWorldMap.countries, 'countries', 0, worldMap.countriesCount, comparisonBudget)) {
            return false;
        }

        if (!this.fillMessageForItem(changeMessages, worldMap.strategicRegions, cachedWorldMap.strategicRegions, 'strategicregions', worldMap.badStrategicRegionsCount, worldMap.strategicRegionsCount, comparisonBudget)) {
            return false;
        }

        if (!this.fillMessageForItem(changeMessages, worldMap.supplyAreas, cachedWorldMap.supplyAreas, 'supplyareas', worldMap.badSupplyAreasCount, worldMap.supplyAreasCount, comparisonBudget)) {
            return false;
        }

        if (!this.fillMessageForItem(changeMessages, worldMap.railways, cachedWorldMap.railways, 'railways', 0, worldMap.railwaysCount, comparisonBudget)) {
            return false;
        }

        if (!this.fillMessageForItem(changeMessages, worldMap.supplyNodes, cachedWorldMap.supplyNodes, 'supplynodes', 0, worldMap.supplyNodesCount, comparisonBudget)) {
            return false;
        }

        if (!this.isCurrentLoadGeneration(loadGeneration)) {
            return true;
        }

        await this.postProgress(localize('worldmap.progress.applying', 'Applying changes...'), loadGeneration);
        if (!this.isCurrentLoadGeneration(loadGeneration)) {
            return true;
        }
        this.pendingWorldMap = { loadGeneration, worldMap };

        for (const message of changeMessages) {
            if (!this.isCurrentLoadGeneration(loadGeneration)) {
                return true;
            }

            Object.assign(message, { loadGeneration });
            await this.postMessageToWebview(message);
        }

        if (this.isCurrentLoadGeneration(loadGeneration)) {
            await this.postMessageToWebview({ command: 'mapupdatecomplete', loadGeneration });
        }

        await this.postProgress('', loadGeneration);
        return true;
    }

    private fillMessageForItem(
        changeMessages: WorldMapMessage[],
        list: unknown[],
        cachedList: unknown[],
        command: MapItemMessage['command'],
        listStart: number,
        listEnd: number,
        comparisonBudget: WorldMapComparisonBudget,
    ): boolean {
        const changeMessagesCountLimit = 30;
        const messageCountLimit = 300;

        let lastDifferenceStart: number | undefined = undefined;
        for (let i = listStart; i <= listEnd; i++) {
            if (i === listEnd) {
                if (lastDifferenceStart !== undefined) {
                    changeMessages.push({
                        command,
                        data: slice(list, lastDifferenceStart, i),
                        start: lastDifferenceStart,
                        end: i,
                        loadGeneration: this.loadGeneration,
                    });
                    if (changeMessages.length > changeMessagesCountLimit) {
                        return false;
                    }
                    lastDifferenceStart = undefined;
                }
                continue;
            }

            const equal = areEqualWithinBudget(list[i], cachedList[i], comparisonBudget);
            if (equal === undefined) {
                return false;
            }

            if (equal) {
                if (lastDifferenceStart !== undefined) {
                    changeMessages.push({
                        command,
                        data: slice(list, lastDifferenceStart, i),
                        start: lastDifferenceStart,
                        end: i,
                        loadGeneration: this.loadGeneration,
                    });
                    if (changeMessages.length > changeMessagesCountLimit) {
                        return false;
                    }
                    lastDifferenceStart = undefined;
                }
            } else {
                if (lastDifferenceStart === undefined) {
                    lastDifferenceStart = i;
                } else if (i - lastDifferenceStart >= messageCountLimit) {
                    changeMessages.push({
                        command,
                        data: slice(list, lastDifferenceStart, i),
                        start: lastDifferenceStart,
                        end: i,
                        loadGeneration: this.loadGeneration,
                    });
                    if (changeMessages.length > changeMessagesCountLimit) {
                        return false;
                    }
                    lastDifferenceStart = i;
                }
            }
        }

        return true;
    }

    private async postMessageToWebview(message: WorldMapMessage) {
        if (!this.panel) {
            return false;
        }

        const startedAt = Date.now();
        try {
            const result = await this.panel.webview.postMessage(message);
            recordPerf('worldmap.postMessage', Date.now() - startedAt, {
                command: message.command,
                ...getWorldMapMessageMetrics(message),
            });
            return result;
        } catch (error) {
            recordPerf('worldmap.postMessage', Date.now() - startedAt, { command: message.command }, false, error);
            throw error;
        }
    }

    private async postProgress(progress: string, loadGeneration: number): Promise<void> {
        if (!this.isCurrentLoadGeneration(loadGeneration)) {
            return;
        }

        debug('Progress:', progress);
        await this.postMessageToWebview({
            command: 'progress',
            data: progress,
            loadGeneration,
        } as WorldMapMessage);
    }

    private isCurrentLoadGeneration(loadGeneration: number | undefined): boolean {
        return loadGeneration === undefined || loadGeneration === this.loadGeneration;
    }

    private commitPendingWorldMap(loadGeneration: number): void {
        if (!this.isCurrentLoadGeneration(loadGeneration) || this.pendingWorldMap?.loadGeneration !== loadGeneration) {
            return;
        }

        this.committedWorldMap = this.pendingWorldMap.worldMap;
        this.pendingWorldMap = undefined;
    }

    private async requestExportMap() {
        const uri = await vscode.window.showSaveDialog({ filters: { [localize('pngfile', 'PNG file')]: ['png'] } });
        this.lastRequestedExportUri = uri;
        if (!uri) {
            return;
        }

        await this.postMessageToWebview({ command: 'requestexportmap' });
    }

    private async exportMap(dataUrl?: string) {
        const uri = this.lastRequestedExportUri;
        if (!uri) {
            return;
        }

        const prefix = 'data:image/png;base64,';
        if (!dataUrl || !dataUrl.startsWith(prefix)) {
            vscode.window.showErrorMessage(localize('worldmap.export.error.imgformat', 'Can\'t export world map: Image is not in correct format.'));
            return;
        }

        try {
            const base64 = dataUrl.substring(prefix.length);
            const buffer = Buffer.from(base64, 'base64');

            await writeFile(uri, buffer);

            vscode.window.showInformationMessage(localize('worldmap.export.success', 'Successfully exported world map.'));

        } catch (e) {
            error(e);
            vscode.window.showErrorMessage(localize('worldmap.export.error', 'Can\'t export world map: {0}.', e));
        }
    }
}

function getMessageSize(message: unknown): number {
    try {
        return JSON.stringify(message).length;
    } catch {
        return 0;
    }
}
