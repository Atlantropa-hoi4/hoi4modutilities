import * as vscode from 'vscode';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewDescriptor } from '../descriptor';
import { WorldMapContainer } from "./worldmapcontainer";

export const worldMap = new WorldMapContainer();

function canPreviewWorldmap(document: vscode.TextDocument) {
    const uri = document.uri;
    return matchPathEnd(uri.toString().toLowerCase(), ['map', 'default.map']) ? 0 : undefined;
}

function onPreviewWorldmap(document: vscode.TextDocument): Promise<void> {
    return worldMap.openPreview();
}

export const worldMapPreviewDef: PreviewDescriptor = {
    kind: 'alternative',
    type: 'worldmap',
    canPreview: canPreviewWorldmap,
    onPreview: onPreviewWorldmap,
};
