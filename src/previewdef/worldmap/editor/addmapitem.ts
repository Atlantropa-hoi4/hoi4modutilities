import * as vscode from 'vscode';
import { localize } from '../../../util/i18n';
import { AddMapItemMessage, State, StrategicRegion, WorldMapData, WorldMapMessage } from '../definitions';
import { parseStateFileContentForTest } from '../loader/states';
import { parseStrategicRegionFileContentForTest } from '../loader/strategicregion';

export async function addMapItem(message: AddMapItemMessage, worldMap: WorldMapData): Promise<WorldMapMessage[]> {
    if (!vscode.workspace.workspaceFolders?.length) {
        await vscode.window.showErrorMessage(localize('worldmap.mustopenafolder.add', 'Must open a folder before adding map files.'));
        return [];
    }
    const folder = vscode.workspace.workspaceFolders.length === 1 ? vscode.workspace.workspaceFolders[0] :
        await vscode.window.showWorkspaceFolderPick({ placeHolder: localize('worldmap.selectafolder.create', 'Select a folder for the new map file') });
    if (!folder) {
        return [];
    }
    return message.type === 'state' ? addState(folder.uri, worldMap) : addStrategicRegion(folder.uri, worldMap);
}

async function addState(folder: vscode.Uri, worldMap: WorldMapData): Promise<WorldMapMessage[]> {
    const id = worldMap.statesCount++;
    const content = `state = {
\tid = ${id}
\tname = "STATE_${id}"
\tmanpower = 0
\tstate_category = wasteland
\thistory = {
\t}
\tprovinces = {
\t}
\tlocal_supplies = 0
}
`;
    const file = `history/states/${id}.txt`;
    const uri = vscode.Uri.joinPath(folder, file);
    if (!await createFile(uri, content)) {
        worldMap.statesCount--;
        return [];
    }
    const state: State = {
        ...parseStateFileContentForTest(content, file)[0],
        boundingBox: { x: 0, y: 0, w: 0, h: 0 },
        centerOfMass: { x: 0, y: 0 },
        mass: 0,
    };
    worldMap.states[id] = state;
    return [
        { command: 'states', data: [state], start: id, end: id + 1, count: worldMap.statesCount },
        { command: 'selectmapitem', type: 'state', id, enterEditMode: true },
    ];
}

async function addStrategicRegion(folder: vscode.Uri, worldMap: WorldMapData): Promise<WorldMapMessage[]> {
    const id = worldMap.strategicRegionsCount++;
    const content = `strategic_region = {
\tid = ${id}
\tname = "STRATEGICREGION_${id}"
\tprovinces = {
\t}
\tweather = {
\t}
}
`;
    const file = `map/strategicregions/${id}.txt`;
    const uri = vscode.Uri.joinPath(folder, file);
    if (!await createFile(uri, content)) {
        worldMap.strategicRegionsCount--;
        return [];
    }
    const region: StrategicRegion = {
        ...parseStrategicRegionFileContentForTest(content, file)[0],
        boundingBox: { x: 0, y: 0, w: 0, h: 0 },
        centerOfMass: { x: 0, y: 0 },
        mass: 0,
    };
    worldMap.strategicRegions[id] = region;
    return [
        { command: 'strategicregions', data: [region], start: id, end: id + 1, count: worldMap.strategicRegionsCount },
        { command: 'selectmapitem', type: 'strategicregion', id, enterEditMode: true },
    ];
}

async function createFile(uri: vscode.Uri, content: string): Promise<boolean> {
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
    edit.insert(uri, new vscode.Position(0, 0), content);
    return vscode.workspace.applyEdit(edit);
}
