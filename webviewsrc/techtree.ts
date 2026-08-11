import { chain, flatMap, min, sumBy } from "lodash";
import { RenderedTechnologyFolder, RenderedTechnologyFolderGridBox, Technology, TechnologyTree } from "../src/previewdef/technology/schema";
import { RenderCommonOptions, calculateBBox, getHeight, getWidth, normalizeNumberLike } from "../src/util/hoi4gui/common";
import { GridBoxConnection, GridBoxItem, getGridBoxItemPosition, renderGridBoxCommon } from "../src/util/hoi4gui/gridboxcommon";
import { setState, getState, scrollToState, tryRun, subscribeRefreshButton, subscribeNavigators, arrayToMap, enableZoom, subscribePreviewLabelToggle, refreshPreviewLabelMode, setPreviewPanDisabled } from "./util/common";
import { StyleTable } from "../src/util/styletable";
import { ConditionItem, conditionItemToStringValue, conditionToString, stringValueToConditionItem } from "../src/hoiformat/condition";
import { DivDropdown } from "./util/dropdown";
import { findTechnologyXorGroups, getAllowedTechnologies, TechnologyXorGroups } from "./technology/conditionfilter";
import { getMovedTechnologyPosition, getTechnologyDoubleClickCreateParent, getTechnologyGridDelta, getTechnologyGridGeometry, hasTechnologyDragPassedThreshold, registerTechnologyPointerGesture } from "../src/previewdef/technology/draginteraction";
import type { TechnologyPositionEdit } from "../src/previewdef/technology/editcommon";
import { normalizePreviewScale } from "../src/util/previewscale";
import { restoreArrayState } from "./util/restoredstate";
import { vscode } from "./util/vscode";
import { feLocalize } from "./util/i18n";

type TechnologyLinkType = 'path' | 'xor';

interface TechnologyGridInfo {
    item: HTMLDivElement;
    gridbox: HTMLDivElement;
    technologyId: string;
    editKey: string;
    treeRoot: string;
    format: 'up' | 'down' | 'left' | 'right' | 'center';
    slotSize: { width: number; height: number };
    gridSize: { width: number; height: number };
    start: { x: number; y: number };
}

const renderedTechFolders: Record<string, RenderedTechnologyFolder> = (window as any).renderedTechFolders;
const technologyTrees: TechnologyTree[] = (window as any).technologyTrees;

let selectedExprs = restoreArrayState<ConditionItem>(getState().selectedExprs);
let selectedFolder: string = getState().folder;
let conditions: DivDropdown | undefined = undefined;
let technologyEditMode = getState().technologyEditMode === true;
let technologyDocumentVersion: number = (window as any).technologyDocumentVersion ?? 0;
let selectedTechnologyIds = new Set<string>(Array.isArray(getState().selectedTechnologyIds) ? getState().selectedTechnologyIds : []);
let pendingLink: { type: 'path' | 'xor'; sourceId: string } | undefined;
let pendingCreate: { parentId: string; treeRoot: string } | undefined;
let activeRequestId: string | undefined;
let pendingPositionEdits = new Map<string, { edits: TechnologyPositionEdit[]; rollback: TechnologyPositionEdit[] }>();
let requestSequence = 0;
let suppressNextTechnologyClick = false;
let blankSelectionClearTimer: number | undefined;

function setTechnologyEditMode(enabled: boolean) {
    technologyEditMode = enabled;
    setPreviewPanDisabled(enabled);
    setState({ technologyEditMode: enabled });
    if (!enabled) {
        clearTechnologyInteractionState(true);
    }
    refreshTechnologyEditUi();
}

function refreshTechnologyEditUi() {
    const button = document.getElementById('technology-edit-toggle') as HTMLButtonElement | null;
    if (button) {
        button.setAttribute('aria-pressed', technologyEditMode ? 'true' : 'false');
        button.style.color = technologyEditMode ? 'var(--vscode-focusBorder)' : '';
        button.style.background = technologyEditMode ? 'rgba(32, 124, 229, 0.14)' : '';
    }
    document.querySelectorAll<HTMLDivElement>('.technology-grid-item').forEach(item => {
        const selected = selectedTechnologyIds.has(item.dataset.technologyId ?? '');
        item.style.outline = selected ? '2px solid var(--vscode-focusBorder)' : '';
        item.style.outlineOffset = selected ? '2px' : '';
        const editable = item.dataset.technologyEditable === 'true';
        item.style.cursor = technologyEditMode && editable ? 'grab' : '';
        item.style.opacity = technologyEditMode && !editable ? '0.72' : '';
    });
    document.querySelectorAll<HTMLDivElement>('.technology-gridbox').forEach(gridbox => {
        gridbox.style.pointerEvents = technologyEditMode ? 'auto' : '';
    });
    updateTechnologyEditStatus();
}

function updateTechnologyEditStatus(message?: string) {
    const status = document.getElementById('technology-edit-status');
    if (!status) {
        return;
    }
    status.textContent = message
        ?? (activeRequestId
            ? feLocalize('TODO', 'Applying…')
            : pendingLink
                ? pendingLink.type === 'path'
                    ? feLocalize('TODO', 'Select Path target')
                    : feLocalize('TODO', 'Select XOR target')
                : pendingCreate
                    ? feLocalize('TODO', 'Select an empty grid position')
                    : technologyEditMode
                        ? feLocalize('TODO', '{0} selected', selectedTechnologyIds.size)
                        : '');
}

function persistTechnologySelection() {
    setState({ selectedTechnologyIds: Array.from(selectedTechnologyIds) });
    refreshTechnologyEditUi();
}

function clearTechnologyInteractionState(clearSelection: boolean) {
    if (blankSelectionClearTimer !== undefined) {
        window.clearTimeout(blankSelectionClearTimer);
        blankSelectionClearTimer = undefined;
    }
    pendingLink = undefined;
    pendingCreate = undefined;
    hideTechnologyContextMenu();
    if (clearSelection) {
        selectedTechnologyIds.clear();
        persistTechnologySelection();
    } else {
        updateTechnologyEditStatus();
    }
}

function getTechnologyGridItem(target: EventTarget | null): HTMLDivElement | null {
    return target instanceof Element
        ? target.closest<HTMLDivElement>('.technology-grid-item[data-technology-id]')
        : null;
}

function getEditableTechnologyGridItem(target: EventTarget | null): HTMLDivElement | null {
    const item = getTechnologyGridItem(target);
    return item?.dataset.technologyEditable === 'true' ? item : null;
}

function getTechnologyGridInfo(item: HTMLDivElement): TechnologyGridInfo | undefined {
    const gridbox = item.closest<HTMLDivElement>('.technology-gridbox');
    const technologyId = item.dataset.technologyId;
    const editKey = item.dataset.technologyEditKey;
    const treeRoot = item.dataset.treeRoot;
    if (!gridbox || !technologyId || !editKey || !treeRoot) {
        return undefined;
    }
    const numberValue = (value: string | undefined) => value === undefined ? NaN : Number(value);
    const format = (gridbox.dataset.gridFormat ?? 'up') as TechnologyGridInfo['format'];
    const info: TechnologyGridInfo = {
        item,
        gridbox,
        technologyId,
        editKey,
        treeRoot,
        format,
        slotSize: {
            width: numberValue(gridbox.dataset.slotWidth),
            height: numberValue(gridbox.dataset.slotHeight),
        },
        gridSize: {
            width: numberValue(gridbox.dataset.gridWidth),
            height: numberValue(gridbox.dataset.gridHeight),
        },
        start: {
            x: numberValue(item.dataset.gridX),
            y: numberValue(item.dataset.gridY),
        },
    };
    return [info.slotSize.width, info.slotSize.height, info.gridSize.width, info.gridSize.height]
        .every(value => Number.isFinite(value) && value > 0)
        && [info.start.x, info.start.y].every(Number.isFinite)
        ? info
        : undefined;
}

function nextTechnologyRequestId(): string {
    requestSequence += 1;
    return `technology-edit-${Date.now()}-${requestSequence}`;
}

function postTechnologyEdit(
    command: string,
    payload: Record<string, unknown>,
    positionEditTransaction?: { edits: TechnologyPositionEdit[]; rollback: TechnologyPositionEdit[] },
) {
    if (activeRequestId) {
        return;
    }
    const requestId = nextTechnologyRequestId();
    activeRequestId = requestId;
    if (positionEditTransaction) {
        pendingPositionEdits.set(requestId, positionEditTransaction);
    }
    vscode.postMessage({
        command,
        requestId,
        documentVersion: technologyDocumentVersion,
        folder: selectedFolder,
        ...payload,
    });
    updateTechnologyEditStatus();
}

function ensureTechnologyContextMenu(): HTMLDivElement {
    let menu = document.getElementById('technology-context-menu') as HTMLDivElement | null;
    if (menu) {
        return menu;
    }
    menu = document.createElement('div');
    menu.id = 'technology-context-menu';
    Object.assign(menu.style, {
        position: 'fixed', display: 'none', minWidth: '170px', padding: '4px 0',
        background: 'var(--vscode-menu-background)', color: 'var(--vscode-menu-foreground)',
        border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
        boxShadow: '0 4px 18px rgba(0, 0, 0, 0.35)', zIndex: '1100',
    });
    const addButton = (label: string, handler: (technologyId: string, item: HTMLDivElement) => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        Object.assign(button.style, {
            display: 'block', width: '100%', height: '28px', padding: '0 12px', textAlign: 'left',
            background: 'transparent', color: 'inherit', border: 'none', cursor: 'pointer',
        });
        button.addEventListener('mouseenter', () => button.style.background = 'var(--vscode-list-hoverBackground)');
        button.addEventListener('mouseleave', () => button.style.background = 'transparent');
        button.addEventListener('mousedown', event => {
            event.preventDefault();
            event.stopPropagation();
            const technologyId = menu!.dataset.technologyId;
            const item = technologyId
                ? document.querySelector<HTMLDivElement>(`.technology-grid-item[data-technology-id="${cssEscape(technologyId)}"]`)
                : null;
            hideTechnologyContextMenu();
            if (technologyId && item) {
                handler(technologyId, item);
            }
        });
        menu!.appendChild(button);
    };
    addButton(feLocalize('TODO', 'Link Path'), technologyId => {
        pendingLink = { type: 'path', sourceId: technologyId };
        pendingCreate = undefined;
        updateTechnologyEditStatus();
    });
    addButton(feLocalize('TODO', 'Link XOR'), technologyId => {
        pendingLink = { type: 'xor', sourceId: technologyId };
        pendingCreate = undefined;
        updateTechnologyEditStatus();
    });
    addButton(feLocalize('TODO', 'Create Child'), (technologyId, item) => {
        pendingLink = undefined;
        pendingCreate = { parentId: technologyId, treeRoot: item.dataset.treeRoot ?? '' };
        updateTechnologyEditStatus();
    });
    addButton(feLocalize('TODO', 'Delete'), technologyId => {
        const ids = selectedTechnologyIds.has(technologyId) ? Array.from(selectedTechnologyIds) : [technologyId];
        postTechnologyEdit('deleteTechnologies', { technologyIds: ids });
    });
    menu.addEventListener('mousedown', event => event.stopPropagation());
    menu.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
    });
    document.body.appendChild(menu);
    return menu;
}

function showTechnologyContextMenu(item: HTMLDivElement, clientX: number, clientY: number) {
    const menu = ensureTechnologyContextMenu();
    menu.dataset.technologyId = item.dataset.technologyId ?? '';
    menu.style.left = '0';
    menu.style.top = '0';
    menu.style.display = 'block';
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(clientX, Math.max(0, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.min(clientY, Math.max(0, window.innerHeight - rect.height - 4))}px`;
}

function hideTechnologyContextMenu() {
    const menu = document.getElementById('technology-context-menu') as HTMLDivElement | null;
    if (menu) {
        menu.style.display = 'none';
        delete menu.dataset.technologyId;
    }
}

function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

async function buildContent() {
    const mainContent = document.getElementById('mainContent') as HTMLDivElement;
    const folder = selectedFolder;
    const renderedFolder = renderedTechFolders[folder];
    if (!renderedFolder) {
        mainContent.replaceChildren();
        return;
    }

    let template = renderedFolder.template ?? '';

    const styleTable = new StyleTable();
    const commonOptions: RenderCommonOptions = {
        styleTable,
    };
    for (const [startTechId, gridbox] of Object.entries(renderedFolder.gridboxes)) {
        const tree = technologyTrees.find(t => t.startTechnology === startTechId && t.folder === folder);
        if (!tree) {
            continue;
        }
        template = template.replace('{{gridbox-' + startTechId + '}}',
            await renderTechnologyTreeGridBox(tree, gridbox, folder, commonOptions, renderedFolder));
    }

    mainContent.innerHTML = template + styleTable.toStyleElement((window as any).styleNonce);
    subscribeNavigators();
    refreshPreviewLabelMode();
    pruneTechnologySelection();
    refreshTechnologyEditUi();
}

async function renderTechnologyTreeGridBox(
    tree: TechnologyTree,
    gridbox: RenderedTechnologyFolderGridBox,
    folder: string,
    commonOptions: RenderCommonOptions,
    renderedFolder: RenderedTechnologyFolder,
): Promise<string> {
    const xorJointKey = "#xorJoint#";
    const techMap = arrayToMap(tree.technologies, 'id');
    const technologiesInFolder = tree.technologies.filter(t => folder in t.folders);

    const allowedTechnologies = getAllowedTechnologies(technologiesInFolder, selectedExprs);
    const allowedTechnologyIds = new Set(allowedTechnologies.map(technology => technology.id));

    const technologyXorJoints = allowedTechnologies
        .map(tech => findTechnologyXorGroups(techMap, tech, folder, allowedTechnologyIds))
        .filter((item): item is TechnologyXorGroups => item !== undefined && item.xorGroups.length > 0);
    const technologyXorJointsMap: Record<string, {nonXors: Technology[], xorGroups: Technology[][]}> = {};

    technologyXorJoints.forEach(({ tech, nonXors, xorGroups }) => technologyXorJointsMap[tech.id] = { nonXors, xorGroups });

    const technologyItemsArray = allowedTechnologies.map<GridBoxItem>(t => {
        const jointsItem = technologyXorJointsMap[t.id];
        const connections: GridBoxConnection[] = [];
        let leadsToTechs: Technology[];
        if (jointsItem) {
            const { nonXors, xorGroups } = jointsItem;
            leadsToTechs = nonXors;
            connections.push(...xorGroups.map<GridBoxConnection>((_, i) => ({ target: xorJointKey + t.id + i, style: "1px solid #88aaff", targetType: "child" })));
        } else {
            leadsToTechs = t.leadsToTechs
                .map(technologyId => techMap[technologyId])
                .filter((technology): technology is Technology =>
                    technology !== undefined && allowedTechnologyIds.has(technology.id));
        }

        connections.push(...leadsToTechs.map<GridBoxConnection>(c => {
            if (c.leadsToTechs.includes(t.id)) {
                return { target: c.id, style: "1px dashed #88aaff", targetType: "related" };
            }
            return { target: c.id, style: "1px solid #88aaff", targetType: "child" };
        }));

        const folderPosition = t.folders[folder];
        return {
            id: t.id,
            gridX: folderPosition.x,
            gridY: folderPosition.y,
            connections,
            classNames: 'technology-grid-item',
            dataAttributes: {
                'technology-id': t.id,
                'technology-folder': folder,
                'technology-edit-key': folderPosition.edit?.editKey,
                'technology-editable': folderPosition.edit?.editable === true,
                'grid-x': folderPosition.x,
                'grid-y': folderPosition.y,
                'tree-root': tree.startTechnology,
            },
        };
    });

    const technologyXorJointsItemsArray = flatMap(technologyXorJoints, ({ tech, xorGroups }) =>
        xorGroups.map<GridBoxItem>((tl, i) => ({
            id: xorJointKey + tech.id + i,
            gridX: Math.round(sumBy(tl, t => t.folders[folder].x) / tl.length),
            gridY: (min(tl.map(t1 => t1.folders[folder].y)) ?? 0) - 1,
            isJoint: true,
            classNames: 'technology-grid-joint',
            dataAttributes: {
                'grid-x': Math.round(sumBy(tl, t => t.folders[folder].x) / tl.length),
                'grid-y': (min(tl.map(t1 => t1.folders[folder].y)) ?? 0) - 1,
                'tree-root': tree.startTechnology,
            },
            connections: tl.map<GridBoxConnection>(c => {
                return { target: c.id, style: "1px solid red", targetType: "child" };
            }),
        }))
    );

    const hasLineItem = renderedFolder.renderedLines.length === 32;
    const format = gridbox.gridbox.format?._name ?? 'up';
    const [, , gridWidth, gridHeight] = calculateBBox(gridbox.gridbox, gridbox.parentInfo);
    const slotWidth = normalizeNumberLike(getWidth(gridbox.gridbox.slotsize), 0) ?? 50;
    const slotHeight = normalizeNumberLike(getHeight(gridbox.gridbox.slotsize), 0) ?? 50;

    return await renderGridBoxCommon(gridbox.gridbox, gridbox.parentInfo, {
        ...commonOptions,
        classNames: 'technology-gridbox',
        dataAttributes: {
            'technology-folder': folder,
            'tree-root': tree.startTechnology,
            'grid-format': format,
            'grid-width': gridWidth,
            'grid-height': gridHeight,
            'slot-width': slotWidth,
            'slot-height': slotHeight,
        },
        items: arrayToMap([...technologyItemsArray, ...technologyXorJointsItemsArray], 'id'),
        lineRenderMode: hasLineItem ? 'control' : 'line',
        onRenderItem: async (item, parent) => {
            if (item.id.startsWith(xorJointKey)) {
                const format = gridbox.gridbox.format?._name ?? 'up';
                return format === 'left' || format === 'right' ? renderedFolder.renderedXor.leftRight : renderedFolder.renderedXor.upDown;
            } else {
                return renderedFolder.renderedTechnologies[item.id] ?? '';
            }
        },
        onRenderLineBox: async (item, parent) => {
            if (!hasLineItem) {
                return '';
            }
            const directionalItems = [ item.up, item.down, item.right, item.left ];
            const inSet = chain(directionalItems).compact().flatMap(c => Object.keys(c.in)).uniq().value();
            const outSet = chain(directionalItems).compact().flatMap(c => Object.keys(c.out)).uniq().value();
            let sameInOut = false;

            if (inSet.length === outSet.length) {
                sameInOut = true;
                for (const inItem of inSet) {
                    if (!outSet.includes(inItem)) {
                        sameInOut = false;
                        break;
                    }
                }
            }

            const lineIndex = (item.up ? 1 : 0) | (item.right ? 2 : 0) | (item.down ? 4 : 0) | (item.left ? 8 : 0) | (sameInOut ? 16 : 0);
            return renderedFolder.renderedLines[lineIndex];
        },
    },
    async (_, _1) => gridbox.background);
}

function pruneTechnologySelection() {
    const visibleIds = new Set(Array.from(document.querySelectorAll<HTMLDivElement>('.technology-grid-item[data-technology-id]'))
        .map(item => item.dataset.technologyId ?? ''));
    const next = new Set(Array.from(selectedTechnologyIds).filter(id => visibleIds.has(id)));
    if (next.size !== selectedTechnologyIds.size) {
        selectedTechnologyIds = next;
        setState({ selectedTechnologyIds: Array.from(selectedTechnologyIds) });
    }
}

function setupTechnologyEditHandlers() {
    const editButton = document.getElementById('technology-edit-toggle') as HTMLButtonElement | null;
    editButton?.addEventListener('click', () => setTechnologyEditMode(!technologyEditMode));

    document.addEventListener('contextmenu', event => {
        if (!technologyEditMode) {
            hideTechnologyContextMenu();
            return;
        }
        const item = getEditableTechnologyGridItem(event.target);
        if (!item) {
            hideTechnologyContextMenu();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        showTechnologyContextMenu(item, event.clientX, event.clientY);
    }, true);

    document.addEventListener('pointerdown', event => {
        if (!technologyEditMode || event.button !== 0 || activeRequestId || pendingLink || pendingCreate) {
            return;
        }
        const item = getEditableTechnologyGridItem(event.target);
        if (!item) {
            return;
        }
        startTechnologyDrag(item, event);
    }, true);

    setupTechnologyMarqueeSelection();

    document.addEventListener('click', event => {
        if (!technologyEditMode) {
            return;
        }
        if ((event.target as Element | null)?.closest('#technology-context-menu, #technology-edit-toggle')) {
            return;
        }
        hideTechnologyContextMenu();
        if (suppressNextTechnologyClick) {
            suppressNextTechnologyClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        const item = getEditableTechnologyGridItem(event.target);
        if (pendingLink) {
            event.preventDefault();
            event.stopPropagation();
            if (!item) {
                pendingLink = undefined;
                updateTechnologyEditStatus();
                return;
            }
            const targetId = item.dataset.technologyId;
            const link = pendingLink;
            pendingLink = undefined;
            if (!targetId || targetId === link.sourceId) {
                updateTechnologyEditStatus();
                return;
            }
            postTechnologyEdit(link.type === 'path' ? 'toggleTechnologyPath' : 'toggleTechnologyXor', {
                sourceTechnologyId: link.sourceId,
                targetTechnologyId: targetId,
            });
            return;
        }

        if (pendingCreate) {
            event.preventDefault();
            event.stopPropagation();
            if (item) {
                updateTechnologyEditStatus(feLocalize('TODO', 'Select an empty grid position'));
                return;
            }
            const gridbox = getTechnologyGridboxAtPoint(event.clientX, event.clientY);
            const create = pendingCreate;
            if (!gridbox || gridbox.dataset.treeRoot !== create.treeRoot) {
                updateTechnologyEditStatus(feLocalize('TODO', 'Select an empty position in the parent tree'));
                return;
            }
            const position = getTechnologyGridPositionAtPoint(gridbox, event.clientX, event.clientY);
            if (!position || hasTechnologyAtGridPosition(gridbox, position.x, position.y)) {
                updateTechnologyEditStatus(feLocalize('TODO', 'That grid position is not available'));
                return;
            }
            pendingCreate = undefined;
            postTechnologyEdit('createChildTechnologyAtPosition', {
                parentTechnologyId: create.parentId,
                x: position.x,
                y: position.y,
            });
            return;
        }

        if (item) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!event.shiftKey) {
            if (blankSelectionClearTimer !== undefined) {
                window.clearTimeout(blankSelectionClearTimer);
            }
            blankSelectionClearTimer = window.setTimeout(() => {
                blankSelectionClearTimer = undefined;
                selectedTechnologyIds.clear();
                persistTechnologySelection();
            }, 250);
        }
    }, true);

    document.addEventListener('dblclick', event => {
        if (!technologyEditMode || activeRequestId || pendingLink || pendingCreate || getTechnologyGridItem(event.target)) {
            return;
        }
        const gridbox = getTechnologyGridboxAtPoint(event.clientX, event.clientY);
        const position = gridbox && getTechnologyGridPositionAtPoint(gridbox, event.clientX, event.clientY);
        if (!gridbox || !position || hasTechnologyAtGridPosition(gridbox, position.x, position.y)) {
            return;
        }
        if (blankSelectionClearTimer !== undefined) {
            window.clearTimeout(blankSelectionClearTimer);
            blankSelectionClearTimer = undefined;
        }
        const treeRoot = gridbox.dataset.treeRoot;
        if (!treeRoot) {
            return;
        }
        const treeRootByTechnologyId = Object.fromEntries(
            Array.from(document.querySelectorAll<HTMLDivElement>('.technology-grid-item[data-technology-id]'))
                .map(item => [item.dataset.technologyId ?? '', item.dataset.treeRoot ?? '']),
        );
        const parentTechnologyId = getTechnologyDoubleClickCreateParent(
            Array.from(selectedTechnologyIds),
            treeRoot,
            treeRootByTechnologyId,
        );
        event.preventDefault();
        event.stopPropagation();
        postTechnologyEdit('createChildTechnologyAtPosition', {
            parentTechnologyId,
            x: position.x,
            y: position.y,
        });
    }, true);

    document.addEventListener('keydown', event => {
        if (!technologyEditMode || event.key !== 'Escape') {
            return;
        }
        clearTechnologyInteractionState(true);
    }, true);

    window.addEventListener('message', event => {
        const message = event.data as {
            command?: string;
            requestId?: string;
            documentVersion?: number;
            reason?: string;
            cancelled?: boolean;
        };
        if ((message.command !== 'technologyEditApplied' && message.command !== 'technologyEditRejected')
            || !message.requestId
            || message.requestId !== activeRequestId) {
            return;
        }
        const positionTransaction = pendingPositionEdits.get(message.requestId);
        pendingPositionEdits.delete(message.requestId);
        activeRequestId = undefined;
        if (typeof message.documentVersion === 'number') {
            technologyDocumentVersion = message.documentVersion;
        }
        if (message.command === 'technologyEditApplied' && positionTransaction) {
            applyTechnologyPositionsLocally(positionTransaction.edits);
            void buildContent();
        } else if (message.command === 'technologyEditRejected') {
            if (positionTransaction) {
                applyTechnologyPositionsLocally(positionTransaction.rollback);
            }
            void buildContent();
            updateTechnologyEditStatus(message.cancelled ? undefined : message.reason);
        } else {
            updateTechnologyEditStatus();
        }
    });
}

function startTechnologyDrag(item: HTMLDivElement, event: PointerEvent) {
    const technologyId = item.dataset.technologyId;
    if (!technologyId) {
        return;
    }
    if (event.shiftKey) {
        if (selectedTechnologyIds.has(technologyId)) {
            selectedTechnologyIds.delete(technologyId);
        } else {
            selectedTechnologyIds.add(technologyId);
        }
        persistTechnologySelection();
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    if (!selectedTechnologyIds.has(technologyId)) {
        selectedTechnologyIds.clear();
        selectedTechnologyIds.add(technologyId);
        persistTechnologySelection();
    }

    const infos = Array.from(document.querySelectorAll<HTMLDivElement>('.technology-grid-item[data-technology-editable="true"]'))
        .filter(candidate => selectedTechnologyIds.has(candidate.dataset.technologyId ?? ''))
        .map(getTechnologyGridInfo)
        .filter((info): info is TechnologyGridInfo => info !== undefined);
    if (infos.length === 0) {
        return;
    }
    const startPageX = event.pageX;
    const startPageY = event.pageY;
    let dragging = false;
    let valid = true;
    let targetEdits: TechnologyPositionEdit[] = [];

    const move = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.pageX - startPageX;
        const deltaY = moveEvent.pageY - startPageY;
        if (!dragging && !hasTechnologyDragPassedThreshold(deltaX, deltaY, 4)) {
            return;
        }
        dragging = true;
        const scale = normalizePreviewScale(getState().scale);
        const targets = infos.map(info => {
            const delta = getTechnologyGridDelta(deltaX, deltaY, scale, info.format, info.slotSize);
            return { info, position: getMovedTechnologyPosition(info.start, delta) };
        });
        valid = validateTechnologyDragTargets(targets, infos);
        targetEdits = targets.map(({ info, position }) => ({
            technologyId: info.technologyId,
            editKey: info.editKey,
            x: position.x,
            y: position.y,
        }));
        for (const { info, position } of targets) {
            const startPixel = getGridBoxItemPosition(info.start.x, info.start.y, info.format, info.slotSize, info.gridSize);
            const targetPixel = getGridBoxItemPosition(position.x, position.y, info.format, info.slotSize, info.gridSize);
            info.item.style.transform = `translate(${targetPixel.x - startPixel.x}px, ${targetPixel.y - startPixel.y}px)`;
            info.item.style.outlineColor = valid ? 'var(--vscode-focusBorder)' : 'var(--vscode-errorForeground)';
            info.item.style.zIndex = '20';
        }
        updateTechnologyEditStatus(valid
            ? feLocalize('TODO', '{0} moving', targetEdits.length)
            : feLocalize('TODO', 'Position is occupied or outside the grid'));
        moveEvent.preventDefault();
    };

    const finish = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', finish, true);
        window.removeEventListener('pointercancel', cancel, true);
        if (!dragging || !valid || targetEdits.every(edit => {
            const info = infos.find(candidate => candidate.technologyId === edit.technologyId)!;
            return edit.x === info.start.x && edit.y === info.start.y;
        })) {
            resetTechnologyDragStyles(infos);
            updateTechnologyEditStatus();
            return;
        }
        suppressNextTechnologyClick = true;
        const rollback = infos.map(info => ({
            technologyId: info.technologyId,
            editKey: info.editKey,
            x: info.start.x,
            y: info.start.y,
        }));
        applyTechnologyPositionsLocally(targetEdits);
        postTechnologyEdit('applyTechnologyPositionEdits', { edits: targetEdits }, { edits: targetEdits, rollback });
    };
    const cancel = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', finish, true);
        window.removeEventListener('pointercancel', cancel, true);
        resetTechnologyDragStyles(infos);
        updateTechnologyEditStatus();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', cancel, true);
    event.preventDefault();
    event.stopPropagation();
}

function resetTechnologyDragStyles(infos: readonly TechnologyGridInfo[]) {
    infos.forEach(info => {
        info.item.style.transform = '';
        info.item.style.outlineColor = '';
        info.item.style.zIndex = '';
    });
}

function validateTechnologyDragTargets(
    targets: readonly { info: TechnologyGridInfo; position: { x: number; y: number } }[],
    selectedInfos: readonly TechnologyGridInfo[],
): boolean {
    const selectedElements = new Set(selectedInfos.map(info => info.item));
    const occupied = new Set<string>();
    document.querySelectorAll<HTMLDivElement>('.technology-grid-item[data-technology-id], .technology-grid-joint').forEach(candidate => {
        if (!selectedElements.has(candidate)) {
            occupied.add(`${candidate.dataset.treeRoot}\u0000${candidate.dataset.gridX}\u0000${candidate.dataset.gridY}`);
        }
    });
    const targetKeys = new Set<string>();
    for (const { info, position } of targets) {
        const pixel = getGridBoxItemPosition(position.x, position.y, info.format, info.slotSize, info.gridSize);
        if (pixel.x < 0 || pixel.y < 0
            || pixel.x + info.slotSize.width > info.gridSize.width
            || pixel.y + info.slotSize.height > info.gridSize.height) {
            return false;
        }
        const key = `${info.treeRoot}\u0000${position.x}\u0000${position.y}`;
        if (occupied.has(key) || targetKeys.has(key)) {
            return false;
        }
        targetKeys.add(key);
    }
    return true;
}

function setupTechnologyMarqueeSelection() {
    document.addEventListener('pointerdown', event => {
        if (!technologyEditMode || event.button !== 0 || !event.shiftKey || activeRequestId || pendingLink || pendingCreate
            || getTechnologyGridItem(event.target)
            || (event.target as Element | null)?.closest('.toolbar-outer, input, select, button')) {
            return;
        }
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', border: '1px solid var(--vscode-focusBorder)',
            background: 'rgba(32, 124, 229, 0.12)', pointerEvents: 'none', zIndex: '1000',
        });
        document.body.appendChild(overlay);
        const startX = event.clientX;
        const startY = event.clientY;
        const move = (moveEvent: PointerEvent) => {
            overlay.style.left = `${Math.min(startX, moveEvent.clientX)}px`;
            overlay.style.top = `${Math.min(startY, moveEvent.clientY)}px`;
            overlay.style.width = `${Math.abs(moveEvent.clientX - startX)}px`;
            overlay.style.height = `${Math.abs(moveEvent.clientY - startY)}px`;
            moveEvent.preventDefault();
        };
        let cleanup = () => overlay.remove();
        const finish = (upEvent: PointerEvent) => {
            cleanup();
            overlay.remove();
            const selectionRect = {
                left: Math.min(startX, upEvent.clientX), right: Math.max(startX, upEvent.clientX),
                top: Math.min(startY, upEvent.clientY), bottom: Math.max(startY, upEvent.clientY),
            };
            document.querySelectorAll<HTMLDivElement>('.technology-grid-item[data-technology-editable="true"]').forEach(candidate => {
                const rect = candidate.getBoundingClientRect();
                if (rect.right >= selectionRect.left && rect.left <= selectionRect.right
                    && rect.bottom >= selectionRect.top && rect.top <= selectionRect.bottom) {
                    selectedTechnologyIds.add(candidate.dataset.technologyId ?? '');
                }
            });
            suppressNextTechnologyClick = true;
            persistTechnologySelection();
        };
        const cancel = () => {
            cleanup();
            overlay.remove();
        };
        cleanup = registerTechnologyPointerGesture(window, move, finish, cancel);
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

function getTechnologyGridboxAtPoint(clientX: number, clientY: number): HTMLDivElement | null {
    const dragger = document.getElementById('dragger');
    const previous = dragger?.style.pointerEvents;
    if (dragger) {
        dragger.style.pointerEvents = 'none';
    }
    const element = document.elementFromPoint(clientX, clientY);
    if (dragger) {
        dragger.style.pointerEvents = previous ?? '';
    }
    return element?.closest<HTMLDivElement>('.technology-gridbox') ?? null;
}

function getTechnologyGridPositionAtPoint(gridbox: HTMLDivElement, clientX: number, clientY: number): { x: number; y: number } | undefined {
    const rect = gridbox.getBoundingClientRect();
    const scale = normalizePreviewScale(getState().scale);
    const geometry = getTechnologyGridGeometry(gridbox.dataset);
    if (!geometry) {
        return undefined;
    }
    const { format, slotSize, gridSize } = geometry;
    const origin = getGridBoxItemPosition(0, 0, format, slotSize, gridSize);
    return getTechnologyGridDelta(
        (clientX - rect.left) / scale - origin.x,
        (clientY - rect.top) / scale - origin.y,
        1,
        format,
        slotSize,
    );
}

function hasTechnologyAtGridPosition(gridbox: HTMLDivElement, x: number, y: number): boolean {
    return Array.from(gridbox.querySelectorAll<HTMLDivElement>('.technology-grid-item[data-technology-id], .technology-grid-joint'))
        .some(item => Number(item.dataset.gridX) === x && Number(item.dataset.gridY) === y);
}

function applyTechnologyPositionsLocally(edits: readonly TechnologyPositionEdit[]) {
    for (const edit of edits) {
        for (const tree of technologyTrees) {
            const technology = tree.technologies.find(candidate => candidate.id === edit.technologyId);
            for (const folder of Object.values(technology?.folders ?? {})) {
                if (folder.edit?.editKey === edit.editKey) {
                    folder.x = edit.x;
                    folder.y = edit.y;
                }
            }
        }
    }
}

async function folderChange(folder: string, clearCondition: boolean) {
    if (!(folder in renderedTechFolders)) {
        return;
    }

    if (selectedFolder !== folder) {
        clearTechnologyInteractionState(true);
    }
    selectedFolder = folder;
    setState({ folder: folder });

    const conditionExprs = chain(technologyTrees).filter(t => t.folder === folder).flatMap(t => t.conditionExprs).uniqBy(e => e.scopeName + '!' + e.nodeContent).value();
    const conditionOptions = conditionExprs.map(option => ({ value: conditionItemToStringValue(option), text: conditionToString(option) }));
    const conditionOptionValues = new Set(conditionOptions.map(option => option.value));

    const conditionContainerElement = document.getElementById('condition-container') as HTMLDivElement | null;
    if (conditionContainerElement) {
        conditionContainerElement.style.display = conditionExprs.length > 0 ? 'block' : 'none';
    }

    if (conditions) {
        conditions.setupOptions(conditionOptions);
        conditions.selectedValues$.next(clearCondition
            ? []
            : selectedExprs.map(conditionItemToStringValue).filter(value => conditionOptionValues.has(value)));
    }

    await buildContent();
}

window.addEventListener('load', tryRun(async function() {
    const defaultLabelMode = (window as any).technologyDefaultLabelMode === 'id' ? 'id' : 'name';
    subscribePreviewLabelToggle(defaultLabelMode);

    // Tech tree folder selector
    const element = document.getElementById('folderSelector') as HTMLSelectElement;
    const restoredFolder = getState().folder;
    const legacyFolder = typeof restoredFolder === 'string' && restoredFolder.startsWith('techfolder_')
        ? restoredFolder.slice('techfolder_'.length)
        : restoredFolder;
    const folder = typeof legacyFolder === 'string' && legacyFolder in renderedTechFolders
        ? legacyFolder
        : element.value;
    element.value = folder;
    element.addEventListener('change', function() {
        folderChange(this.value, true);
    });

    // Conditions
    const conditionsElement = document.getElementById('conditions') as HTMLDivElement | null;
    if (conditionsElement) {
        conditions = new DivDropdown(conditionsElement, true);

        conditions.selectedValues$.next(selectedExprs.map(conditionItemToStringValue));
        conditions.selectedValues$.subscribe(async (selection) => {
            selectedExprs = selection.map<ConditionItem>(stringValueToConditionItem);
            setState({ selectedExprs });
            await buildContent();
        });
    }

    // Zoom
    const contentElement = document.getElementById('mainContent') as HTMLDivElement;
    enableZoom(contentElement, 0, 40);
    setPreviewPanDisabled(technologyEditMode);
    setupTechnologyEditHandlers();

    subscribeRefreshButton();
    await folderChange(folder, false);
    scrollToState();
}));
