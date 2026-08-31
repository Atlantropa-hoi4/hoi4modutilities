import * as vscode from 'vscode';
import { chain } from 'lodash';
import { convertNodeToJson, Enum, SchemaDef } from '../../../hoiformat/schema';
import { parseHoi4File, Token } from '../../../hoiformat/hoiparser';
import { forceError } from '../../../util/common';
import { getFilePathFromMod, getHoiOpenedFileOriginalUri, readFileFromModOrHOI4 } from '../../../util/fileloader';
import { localize } from '../../../util/i18n';
import { dirUri, mkdirs, writeFile } from '../../../util/vsccommon';
import { MoveProvinceItem, MoveProvinceMessage, WorldMapData, WorldMapMessage } from '../definitions';

interface ProvincesContainer {
    id?: number;
    provinces: (Enum & { _valueStartToken?: Token; _valueEndToken?: Token })[];
    history?: { victory_points: (Enum & { _valueEndToken?: Token })[]; _valueEndToken?: Token };
    _token?: Token;
    _valueEndToken?: Token;
}

interface ProvincesContainerFile {
    state: ProvincesContainer[];
    strategic_region: ProvincesContainer[];
}

const containerSchema: SchemaDef<any> = {
    id: 'number',
    provinces: { _innerType: 'enum', _type: 'array' },
    history: { victory_points: { _innerType: 'enum', _type: 'array' } },
};

const fileSchema: SchemaDef<any> = {
    state: { _innerType: containerSchema, _type: 'array' },
    strategic_region: { _innerType: containerSchema, _type: 'array' },
};

export async function moveProvince(message: MoveProvinceMessage, worldMap: WorldMapData): Promise<WorldMapMessage[]> {
    if (!await validateItems(message.items, worldMap)) {
        return [];
    }
    const uris = await resolveEditableFiles(message.items);
    if (!uris) {
        return [];
    }

    const edit = new vscode.WorkspaceEdit();
    const result: WorldMapMessage[] = [];
    for (const item of message.items) {
        const regions = item.type === 'state' ? worldMap.states : worldMap.strategicRegions;
        const target = regions[item.to];
        const source = item.from === undefined ? undefined : regions[item.from];
        if (!target) {
            continue;
        }

        const movedVictoryPoints = item.type === 'state' && source && 'victoryPoints' in source ?
            item.provinces.flatMap(province => source.victoryPoints[province] === undefined ? [] : [{ province, value: source.victoryPoints[province]!, remove: true }]) : [];
        if (source && item.from !== item.to && item.fromFile) {
            const sourceDocument = await vscode.workspace.openTextDocument(uris.get(item.fromFile)!);
            const provinces = source.provinces.filter(province => !item.provinces.includes(province));
            if (setProvinces(edit, item.type, source.id, item.fromFile, sourceDocument, provinces, movedVictoryPoints, source.token)) {
                source.provinces = provinces;
                if ('victoryPoints' in source) {
                    movedVictoryPoints.forEach(vp => delete source.victoryPoints[vp.province]);
                }
                result.push(updateMessage(item.type, source));
            }
        }

        const targetDocument = await vscode.workspace.openTextDocument(uris.get(item.toFile)!);
        const provinces = item.from === item.to ? target.provinces.filter(province => !item.provinces.includes(province)) :
            [...new Set([...target.provinces, ...item.provinces])];
        movedVictoryPoints.forEach(vp => vp.remove = false);
        if (setProvinces(edit, item.type, target.id, item.toFile, targetDocument, provinces, movedVictoryPoints, target.token)) {
            target.provinces = provinces;
            if ('victoryPoints' in target) {
                movedVictoryPoints.forEach(vp => target.victoryPoints[vp.province] = vp.value);
            }
            result.push(updateMessage(item.type, target));
        }
    }

    if (!await vscode.workspace.applyEdit(edit)) {
        await vscode.window.showErrorMessage(localize('worldmap.edit.failed.apply', 'Failed to apply world map edits.'));
        return [];
    }
    return result;
}

function updateMessage(type: MoveProvinceItem['type'], region: any): WorldMapMessage {
    return { command: type === 'state' ? 'states' : 'strategicregions', data: [region], start: region.id, end: region.id + 1 };
}

async function validateItems(items: MoveProvinceItem[], worldMap: WorldMapData): Promise<boolean> {
    for (const item of items) {
        if (item.type !== 'state' || item.from !== item.to) {
            continue;
        }
        const state = worldMap.states[item.from];
        if (state && item.provinces.some(province => state.victoryPoints[province] !== undefined)) {
            await vscode.window.showErrorMessage(localize('worldmap.edit.failed.cannotremovevp', 'You cannot remove a province with victory point.'));
            return false;
        }
    }
    return true;
}

async function resolveEditableFiles(items: MoveProvinceItem[]): Promise<Map<string, vscode.Uri> | undefined> {
    const files = chain(items).flatMap(item => [item.toFile, item.fromFile]).filter((file): file is string => !!file).uniq().value();
    const result = new Map<string, vscode.Uri>();
    const missing: string[] = [];
    await Promise.all(files.map(async file => {
        const path = await getFilePathFromMod(file);
        if (path) {
            result.set(file, getHoiOpenedFileOriginalUri(path));
        } else {
            missing.push(file);
        }
    }));
    if (missing.length === 0) {
        return result;
    }
    if (!vscode.workspace.workspaceFolders?.length) {
        await vscode.window.showErrorMessage(localize('worldmap.mustopenafolder.edit', 'Must open a folder before editing map files.'));
        return undefined;
    }
    const folder = vscode.workspace.workspaceFolders.length === 1 ? vscode.workspace.workspaceFolders[0] :
        await vscode.window.showWorkspaceFolderPick({ placeHolder: localize('worldmap.selectafolder.edit', 'Select a folder for editable map files') });
    if (!folder) {
        return undefined;
    }
    for (const file of missing) {
        try {
            const [buffer] = await readFileFromModOrHOI4(file);
            const target = vscode.Uri.joinPath(folder.uri, file);
            await mkdirs(dirUri(target));
            await writeFile(target, buffer);
            result.set(file, target);
        } catch (error) {
            await vscode.window.showErrorMessage(localize('worldmap.edit.failed.copy', 'Failed to copy map file: {0}.', forceError(error).toString()));
            return undefined;
        }
    }
    return result;
}

function setProvinces(
    edit: vscode.WorkspaceEdit,
    type: MoveProvinceItem['type'],
    id: number,
    relativePath: string,
    document: vscode.TextDocument,
    provinces: number[],
    victoryPoints: { province: number; value: number; remove: boolean; text?: string }[],
    token: Token | null,
): boolean {
    const text = document.getText();
    const parsed = convertNodeToJson<any>(parseHoi4File(text, localize('infile', 'In file {0}:\n', relativePath)), fileSchema);
    const list: any[] = type === 'state' ? parsed.state : parsed.strategic_region;
    const item = list.find(candidate => candidate.id === id) ?? list.find(candidate => candidate._token?.start === token?.start);
    if (!item) {
        return false;
    }
    const indent = detectIndent(text);
    const sorted = [...provinces].sort((a, b) => a - b);
    const endPosition = document.positionAt(item._valueEndToken?.start ?? text.length).with({ character: 0 });
    if (item.provinces.length === 0) {
        edit.insert(document.uri, endPosition, `${indent}provinces = {\n${indent}${indent}${sorted.join(' ')}\n${indent}}\n`);
    } else {
        const first = item.provinces[0];
        const startOffset = first._valueStartToken?.start;
        const endOffset = item.provinces[item.provinces.length - 1]._valueEndToken?.end;
        if (startOffset === undefined || endOffset === undefined) {
            return false;
        }
        edit.replace(document.uri, new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset)),
            `{\n${indent}${indent}${sorted.join(' ')}\n${indent}}`);
    }
    if (type === 'state') {
        updateVictoryPoints(edit, document, item, victoryPoints, text, indent, endPosition);
    }
    return true;
}

function updateVictoryPoints(
    edit: vscode.WorkspaceEdit,
    document: vscode.TextDocument,
    item: any,
    victoryPoints: { province: number; remove: boolean; text?: string }[],
    text: string,
    indent: string,
    fallbackPosition: vscode.Position,
): void {
    for (const victoryPoint of victoryPoints) {
        if (victoryPoint.remove) {
            const existing = item.history?.victory_points.find((vp: any) => vp._values[0] === victoryPoint.province.toString());
            if (existing?._token?.start !== undefined && existing._valueEndToken?.end !== undefined) {
                victoryPoint.text = text.slice(existing._token.start, existing._valueEndToken.end);
                edit.delete(document.uri, new vscode.Range(document.positionAt(existing._token.start), document.positionAt(existing._valueEndToken.end)));
            }
        } else {
            const vpText = victoryPoint.text ?? `victory_points = { ${victoryPoint.province} 1 }`;
            const position = item.history?._valueEndToken?.start === undefined ? fallbackPosition :
                document.positionAt(item.history._valueEndToken.start).with({ character: 0 });
            edit.insert(document.uri, position, item.history ? `${indent}${indent}${vpText}\n` : `${indent}history = {\n${indent}${indent}${vpText}\n${indent}}\n`);
        }
    }
}

function detectIndent(text: string): string {
    const match = /^([ \t]+)\S/m.exec(text);
    return match?.[1] ?? '\t';
}
