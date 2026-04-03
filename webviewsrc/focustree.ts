import { getState, setState, arrayToMap, subscribeNavigators, scrollToState, tryRun, enableZoom, setPreviewPanDisabled } from "./util/common";
import { DivDropdown } from "./util/dropdown";
import { difference, minBy } from "lodash";
import { renderGridBoxCommon, GridBoxItem, GridBoxConnection } from "../src/util/hoi4gui/gridboxcommon";
import { StyleTable, normalizeForStyle } from "../src/util/styletable";
import { FocusTree, Focus } from "../src/previewdef/focustree/schema";
import { applyCondition, ConditionItem } from "../src/hoiformat/condition";
import { NumberPosition } from "../src/util/common";
import { GridBoxType } from "../src/hoiformat/gui";
import { toNumberLike } from "../src/hoiformat/schema";
import { Checkbox } from "./util/checkbox";
import { vscode } from "./util/vscode";
import { getFocusPosition, getLocalPositionFromRenderedAbsolute } from "../src/previewdef/focustree/positioning";

function showBranch(visibility: boolean, optionClass: string) {
    const elements = document.getElementsByClassName(optionClass);

    const hiddenBranches = getState().hiddenBranches || {};
    if (visibility) {
        delete hiddenBranches[optionClass];
    } else {
        hiddenBranches[optionClass] = true;
    }
    setState({ hiddenBranches: hiddenBranches });

    for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLDivElement;
        element.style.display = element.className.split(' ').some(b => hiddenBranches[b]) ? "none" : "block";
    }
}

function search(searchContent: string, navigate: boolean = true) {
    const focuses = document.getElementsByClassName('focus');
    const searchedFocus: HTMLDivElement[] = [];
    let navigated = false;
    for (let i = 0; i < focuses.length; i++) {
        const focus = focuses[i] as HTMLDivElement;
        if (searchContent && focus.id.toLowerCase().replace(/^focus_/, '').includes(searchContent)) {
            focus.style.outline = '1px solid #E33';
            focus.style.background = 'rgba(255, 0, 0, 0.5)';
            if (navigate && !navigated) {
                focus.scrollIntoView({ block: "center", inline: "center" });
                navigated = true;
            }
            searchedFocus.push(focus);
        } else {
            focus.style.outlineWidth = '0';
            focus.style.background = 'transparent';
        }
    }

    return searchedFocus;
}

const useConditionInFocus: boolean = (window as any).useConditionInFocus;
const focusTrees: FocusTree[] = (window as any).focusTrees;

let selectedExprs: ConditionItem[] = getState().selectedExprs ?? [];
let selectedInlayExprs: ConditionItem[] = getState().selectedInlayExprs ?? [];
let selectedFocusTreeIndex: number = Math.min(focusTrees.length - 1, getState().selectedFocusTreeIndex ?? 0);
let allowBranches: DivDropdown | undefined = undefined;
let conditions: DivDropdown | undefined = undefined;
let inlayConditions: DivDropdown | undefined = undefined;
let checkedFocuses: Record<string, Checkbox> = {};
let focusPositionEditMode: boolean = !!getState().focusPositionEditMode;
let currentRenderedFocusTree: FocusTree | undefined = undefined;
let currentFocusPositions: Record<string, NumberPosition> = {};
let currentRenderedExprs: ConditionItem[] = [];
let focusPositionDragBindings: Array<{ element: HTMLElement; handler: (event: MouseEvent) => void }> = [];
let focusPositionDocumentVersion: number = (window as any).focusPositionDocumentVersion ?? 0;
let suppressEditableFocusClickUntil = 0;
const xGridSize: number = (window as any).xGridSize;
const yGridSize: number = (window as any).yGridSize ?? 130;
const focusPositionDragThresholdPx = 4;
let currentGridLeftPadding = 0;
let currentGridTopPadding = 0;

function showInlayWindows() {
    return !!(window as any).__showInlayWindows;
}

function getSelectedInlayWindowIds() {
    return getState().selectedInlayWindowIds ?? {} as Record<string, string | undefined>;
}

function getSelectedInlayWindowId(focusTree: FocusTree): string | undefined {
    const selected = getSelectedInlayWindowIds()[focusTree.id];
    if (focusTree.inlayWindows.some(inlay => inlay.id === selected)) {
        return selected;
    }

    return focusTree.inlayWindows[0]?.id;
}

function setSelectedInlayWindowId(focusTree: FocusTree, inlayWindowId: string | undefined) {
    const selectedInlayWindowIds = getSelectedInlayWindowIds();
    selectedInlayWindowIds[focusTree.id] = inlayWindowId;
    setState({ selectedInlayWindowIds });
}

function setFocusPositionEditMode(enabled: boolean) {
    focusPositionEditMode = enabled;
    setPreviewPanDisabled(enabled);
    setState({ focusPositionEditMode: enabled });
    updateFocusPositionEditUi();
}

function updateFocusPositionEditUi() {
    const editButton = document.getElementById('focus-position-edit') as HTMLButtonElement | null;
    if (editButton) {
        editButton.setAttribute('aria-pressed', focusPositionEditMode ? 'true' : 'false');
        editButton.style.fontWeight = focusPositionEditMode ? '700' : '';
    }

    document.querySelectorAll<HTMLElement>('[data-focus-id]').forEach(element => {
        const editable = element.dataset.focusEditable === 'true';
        element.style.cursor = focusPositionEditMode && editable ? 'grab' : 'pointer';
        element.style.boxShadow = focusPositionEditMode && editable
            ? '0 0 0 1px rgba(32, 124, 229, 0.85) inset'
            : '';
    });
}

function getEditableFocusElement(target: EventTarget | null): HTMLDivElement | null {
    const focusElement = (target as HTMLElement | null)?.closest<HTMLDivElement>('[data-focus-id]');
    if (!focusElement || focusElement.dataset.focusEditable !== 'true') {
        return null;
    }

    return focusElement;
}

function getEditableFocusElementAtPoint(clientX: number, clientY: number): HTMLDivElement | null {
    const focusElement = getEditableFocusElement(getElementAtPointIgnoringDragger(clientX, clientY));
    return focusElement;
}

function getElementAtPointIgnoringDragger(clientX: number, clientY: number): HTMLElement | null {
    const dragger = document.getElementById('dragger') as HTMLDivElement | null;
    const previousPointerEvents = dragger?.style.pointerEvents ?? '';
    if (dragger) {
        dragger.style.pointerEvents = 'none';
    }

    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;

    if (dragger) {
        dragger.style.pointerEvents = previousPointerEvents;
    }

    return element;
}

function getEditableFocusElementFromMouseEvent(event: MouseEvent): HTMLDivElement | null {
    return getEditableFocusElement(event.target) ?? getEditableFocusElementAtPoint(event.clientX, event.clientY);
}

function setupFocusPositionDragHandlers() {
    document.addEventListener('click', event => {
        if (!focusPositionEditMode) {
            return;
        }

        const focusElement = getEditableFocusElementFromMouseEvent(event);
        if (!focusElement) {
            return;
        }

        if (Date.now() > suppressEditableFocusClickUntil) {
            return;
        }

        suppressEditableFocusClickUntil = 0;
        event.preventDefault();
        event.stopPropagation();
    }, true);

}

function isBlankCreateTarget(event: MouseEvent): boolean {
    const element = getElementAtPointIgnoringDragger(event.clientX, event.clientY)
        ?? ((event.target as Node | null) instanceof HTMLElement ? event.target as HTMLElement : null);
    if (!element) {
        return false;
    }

    if (element.closest('[data-focus-id], #inlaywindowplaceholder, #continuousFocuses, .toolbar-outer, #warnings-container, input, select, button, textarea, option')) {
        return false;
    }

    const toolbar = document.querySelector('.toolbar-outer') as HTMLElement | null;
    const toolbarBottom = toolbar?.getBoundingClientRect().bottom ?? 0;
    if (event.clientY < toolbarBottom) {
        return false;
    }

    const contentElement = document.getElementById('focustreecontent') as HTMLElement | null;
    const contentRect = contentElement?.getBoundingClientRect();
    if (!contentRect) {
        return false;
    }

    return event.clientX >= contentRect.left && event.clientY >= contentRect.top;
}

function getAbsoluteGridPositionFromMouseEvent(event: MouseEvent): NumberPosition | undefined {
    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement | null;
    if (!contentElement) {
        return undefined;
    }

    const scale = getState().scale || 1;
    const contentRect = contentElement.getBoundingClientRect();
    const localX = (event.clientX - contentRect.left) / scale;
    const localY = (event.clientY - contentRect.top) / scale;

    return {
        x: Math.floor((localX - currentGridLeftPadding) / xGridSize),
        y: Math.floor((localY - currentGridTopPadding) / yGridSize),
    };
}

function hasRenderedFocusAtAbsolutePosition(position: NumberPosition): boolean {
    return Object.values(currentFocusPositions).some(currentPosition => currentPosition.x === position.x && currentPosition.y === position.y);
}

function setupFocusTemplateCreateHandler() {
    document.addEventListener('dblclick', event => {
        if (!focusPositionEditMode || !currentRenderedFocusTree) {
            return;
        }

        if (!isBlankCreateTarget(event)) {
            return;
        }

        const targetPosition = getAbsoluteGridPositionFromMouseEvent(event);
        if (!targetPosition || hasRenderedFocusAtAbsolutePosition(targetPosition)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        vscode.postMessage({
            command: 'createFocusTemplateAtPosition',
            treeEditKey: currentRenderedFocusTree.createTemplate?.editKey ?? '',
            targetAbsoluteX: targetPosition.x,
            targetAbsoluteY: targetPosition.y,
            documentVersion: focusPositionDocumentVersion,
        });
    }, true);
}

function clearFocusPositionDragBindings() {
    focusPositionDragBindings.forEach(binding => {
        binding.element.removeEventListener('mousedown', binding.handler, true);
    });
    focusPositionDragBindings = [];
}

function bindFocusPositionDragHandlers() {
    clearFocusPositionDragBindings();

    document.querySelectorAll<HTMLElement>('[data-focus-id][data-focus-editable="true"]').forEach(focusElement => {
        const handler = (event: MouseEvent) => {
            if (!focusPositionEditMode || event.button !== 0) {
                return;
            }

            if ((event.target as HTMLElement | null)?.closest('input, select, button, textarea, option')) {
                return;
            }

            const focusId = focusElement.dataset.focusId;
            if (!focusId || !currentRenderedFocusTree) {
                return;
            }

            const focus = currentRenderedFocusTree.focuses[focusId];
            const currentPosition = currentFocusPositions[focusId];
            if (!focus || !currentPosition) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const startingPosition = { ...currentPosition };
            let nextAbsolutePosition = { ...startingPosition };
            let dragGestureStarted = false;

            focusElement.style.cursor = 'grabbing';
            focusElement.style.zIndex = '20';
            focusElement.style.willChange = 'transform';

            const mouseMoveHandler = (moveEvent: MouseEvent) => {
                const scale = getState().scale || 1;
                const deltaPageX = moveEvent.pageX - event.pageX;
                const deltaPageY = moveEvent.pageY - event.pageY;
                if (!dragGestureStarted && Math.max(Math.abs(deltaPageX), Math.abs(deltaPageY)) < focusPositionDragThresholdPx) {
                    return;
                }

                dragGestureStarted = true;
                const deltaGridX = Math.round(deltaPageX / scale / xGridSize);
                const deltaGridY = Math.round(deltaPageY / scale / yGridSize);
                nextAbsolutePosition = {
                    x: startingPosition.x + deltaGridX,
                    y: startingPosition.y + deltaGridY,
                };
                focusElement.style.transform = `translate(${deltaPageX / scale}px, ${deltaPageY / scale}px)`;
            };

            const mouseUpHandler = () => {
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
                focusElement.style.transform = '';
                focusElement.style.cursor = 'grab';
                focusElement.style.zIndex = '';
                focusElement.style.willChange = '';

                if (!dragGestureStarted) {
                    return;
                }

                suppressEditableFocusClickUntil = Date.now() + 250;

                if (!currentRenderedFocusTree) {
                    return;
                }

                if (nextAbsolutePosition.x === startingPosition.x && nextAbsolutePosition.y === startingPosition.y) {
                    return;
                }

                const targetLocalPosition = getLocalPositionFromRenderedAbsolute(
                    focus,
                    currentRenderedFocusTree,
                    currentRenderedExprs,
                    nextAbsolutePosition,
                );

                vscode.postMessage({
                    command: 'applyFocusPositionEdit',
                    focusId,
                    targetLocalX: targetLocalPosition.x,
                    targetLocalY: targetLocalPosition.y,
                    documentVersion: focusPositionDocumentVersion,
                });
            };

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        };

        focusElement.addEventListener('mousedown', handler, true);
        focusPositionDragBindings.push({ element: focusElement, handler });
    });
}

function updateFocusPositionAfterApply(focusId: string, targetLocalX: number, targetLocalY: number) {
    if (!currentRenderedFocusTree) {
        return;
    }

    const focus = currentRenderedFocusTree.focuses[focusId];
    if (!focus) {
        return;
    }

    focus.x = targetLocalX;
    focus.y = targetLocalY;

    const recalculatedPositions: Record<string, NumberPosition> = {};
    Object.values(currentRenderedFocusTree.focuses).forEach(currentFocus => {
        getFocusPosition(currentFocus, recalculatedPositions, currentRenderedFocusTree!, currentRenderedExprs);
    });
    currentFocusPositions = recalculatedPositions;
}

async function buildContent() {
    const focusCheckState = getState().checkedFocuses ?? {};
    const checkedFocusesExprs = Object.keys(focusCheckState)
        .filter(fid => focusCheckState[fid])
        .map(fid => ({ scopeName: '', nodeContent: 'has_completed_focus = ' + fid }));
    clearCheckedFocuses();

    const focustreeplaceholder = document.getElementById('focustreeplaceholder') as HTMLDivElement;
    const styleTable = new StyleTable();
    const renderedFocus: Record<string, string> = (window as any).renderedFocus;
    const focusTree = focusTrees[selectedFocusTreeIndex];
    const exprs = [{ scopeName: '', nodeContent: 'has_focus_tree = ' + focusTree.id }, ...checkedFocusesExprs, ...selectedExprs, ...selectedInlayExprs];
    const focuses = Object.values(focusTree.focuses);

    const allowBranchOptionsValue: Record<string, boolean> = {};
    focusTree.allowBranchOptions.forEach(option => {
        const focus = focusTree.focuses[option];
        allowBranchOptionsValue[option] = !focus || focus.allowBranch === undefined || applyCondition(focus.allowBranch, exprs);
    });

    if (focusTree.isSharedFocues) {
        focusTree.allowBranchOptions.forEach(option => {
            allowBranchOptionsValue[option] = true;
        });
    }

    const gridbox: GridBoxType = (window as any).gridBox;

    const focusPosition: Record<string, NumberPosition> = {};
    calculateFocusAllowed(focusTree, allowBranchOptionsValue);
    let renderExprs = exprs;
    let focusGridBoxItems = focuses.map(focus => focusToGridItem(focus, focusTree, allowBranchOptionsValue, focusPosition, renderExprs)).filter((v): v is GridBoxItem => !!v);
    if (focusGridBoxItems.length === 0 && focuses.length > 0 && (selectedExprs.length > 0 || selectedInlayExprs.length > 0)) {
        selectedExprs = [];
        selectedInlayExprs = [];
        setState({ selectedExprs, selectedInlayExprs });
        renderExprs = [{ scopeName: '', nodeContent: 'has_focus_tree = ' + focusTree.id }, ...checkedFocusesExprs];

        const fallbackAllowBranchOptionsValue: Record<string, boolean> = {};
        focusTree.allowBranchOptions.forEach(option => {
            const focus = focusTree.focuses[option];
            fallbackAllowBranchOptionsValue[option] = !focus || focus.allowBranch === undefined || applyCondition(focus.allowBranch, renderExprs);
        });
        if (focusTree.isSharedFocues) {
            focusTree.allowBranchOptions.forEach(option => {
                fallbackAllowBranchOptionsValue[option] = true;
            });
        }

        for (const key of Object.keys(focusPosition)) {
            delete focusPosition[key];
        }
        calculateFocusAllowed(focusTree, fallbackAllowBranchOptionsValue);
        focusGridBoxItems = focuses.map(focus => focusToGridItem(focus, focusTree, fallbackAllowBranchOptionsValue, focusPosition, renderExprs)).filter((v): v is GridBoxItem => !!v);
    }
    currentRenderedFocusTree = focusTree;
    currentFocusPositions = { ...focusPosition };
    currentRenderedExprs = renderExprs;

    const minX = minBy(Object.values(focusPosition), 'x')?.x ?? 0;
    const leftPadding = gridbox.position.x._value - Math.min(minX * xGridSize, 0);
    currentGridLeftPadding = leftPadding;
    currentGridTopPadding = gridbox.position.y._value ?? 0;

    const focusTreeContent = await renderGridBoxCommon({ ...gridbox, position: { ...gridbox.position, x: toNumberLike(leftPadding) } }, {
        size: { width: 0, height: 0 },
        orientation: 'upper_left'
    }, {
        id: 'focus-gridbox',
        styleTable,
        items: arrayToMap(focusGridBoxItems, 'id'),
        onRenderItem: item => Promise.resolve(
            renderedFocus[item.id]
                .replace('{{position}}', item.gridX + ', ' + item.gridY)
                .replace('{{iconClass}}', getFocusIcon(focusTree.focuses[item.id], renderExprs, styleTable))
            ),
        cornerPosition: 0.5,
    });

    focustreeplaceholder.innerHTML = focusTreeContent + styleTable.toStyleElement((window as any).styleNonce);
    const inlayWindowPlaceholder = document.getElementById('inlaywindowplaceholder') as HTMLDivElement;
    inlayWindowPlaceholder.innerHTML = renderInlayWindows(focusTree, renderExprs);

    bindFocusPositionDragHandlers();
    subscribeNavigators();
    setupCheckedFocuses(focuses, focusTree);
    updateFocusPositionEditUi();
}

function calculateFocusAllowed(focusTree: FocusTree, allowBranchOptionsValue: Record<string, boolean>) {
    const focuses = focusTree.focuses;

    let changed = true;
    while (changed) {
        changed = false;
        for (const key in focuses) {
            const focus = focuses[key];
            if (focus.prerequisite.length === 0) {
                continue;
            }

            if (focus.id in allowBranchOptionsValue) {
                continue;
            }

            let allow = true;
            for (const andPrerequests of focus.prerequisite) {
                if (andPrerequests.length === 0) {
                    continue;
                }
                allow = allow && andPrerequests.some(p => allowBranchOptionsValue[p] === true);
                const deny = andPrerequests.every(p => allowBranchOptionsValue[p] === false);
                if (deny) {
                    allowBranchOptionsValue[focus.id] = false;
                    changed = true;
                    break;
                }
            }
            if (allow) {
                allowBranchOptionsValue[focus.id] = true;
                changed = true;
            }
        }
    }
}

function updateSelectedFocusTree(clearCondition: boolean) {
    const focusTree = focusTrees[selectedFocusTreeIndex];
    const continuousFocuses = document.getElementById('continuousFocuses') as HTMLDivElement;

    if (focusTree.continuousFocusPositionX !== undefined && focusTree.continuousFocusPositionY !== undefined) {
        continuousFocuses.style.left = (focusTree.continuousFocusPositionX - 59) + 'px';
        continuousFocuses.style.top = (focusTree.continuousFocusPositionY + 7) + 'px';
        continuousFocuses.style.display = 'block';
    } else {
        continuousFocuses.style.display = 'none';
    }

    if (useConditionInFocus) {
        const conditionExprs = dedupeConditionExprs(focusTree.conditionExprs).filter(e => e.scopeName !== '' ||
            (!e.nodeContent.startsWith('has_focus_tree = ') && !e.nodeContent.startsWith('has_completed_focus = ')));
        const currentInlayConditionExprs = dedupeConditionExprs(focusTree.inlayConditionExprs).filter(e => e.scopeName !== '' ||
            (!e.nodeContent.startsWith('has_focus_tree = ') && !e.nodeContent.startsWith('has_completed_focus = ')));

        const conditionContainerElement = document.getElementById('condition-container') as HTMLDivElement | null;
        if (conditionContainerElement) {
            conditionContainerElement.style.display = conditionExprs.length > 0 ? 'block' : 'none';
        }

        if (conditions) {
            conditions.select.innerHTML = `<span class="value"></span>
                ${conditionExprs.map(option =>
                    `<div class="option" value='${option.scopeName}!|${option.nodeContent}'>${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}</div>`
                ).join('')}`;
            conditions.selectedValues$.next(clearCondition ? [] : selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
        }

        const inlayConditionContainerElement = document.getElementById('inlay-condition-container') as HTMLDivElement | null;
        if (inlayConditionContainerElement) {
            inlayConditionContainerElement.style.display = showInlayWindows() && currentInlayConditionExprs.length > 0 ? 'block' : 'none';
        }

        if (inlayConditions) {
            inlayConditions.select.innerHTML = `<span class="value"></span>
                ${currentInlayConditionExprs.map(option =>
                    `<div class="option" value='${option.scopeName}!|${option.nodeContent}'>${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}</div>`
                ).join('')}`;
            inlayConditions.selectedValues$.next(clearCondition ? [] : selectedInlayExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
        }

    } else {
        const allowBranchesContainerElement = document.getElementById('allowbranch-container') as HTMLDivElement | null;
        if (allowBranchesContainerElement) {
            allowBranchesContainerElement.style.display = focusTree.allowBranchOptions.length > 0 ? 'block' : 'none';
        }

        if (allowBranches) {
            allowBranches.select.innerHTML = `<span class="value"></span>
                ${focusTree.allowBranchOptions.map(option => `<div class="option" value="inbranch_${option}">${option}</div>`).join('')}`;
            allowBranches.selectAll();
        }
    }

    const inlayWindowsElement = document.getElementById('inlay-windows') as HTMLSelectElement | null;
    const inlayWindowsContainerElement = document.getElementById('inlay-window-container') as HTMLDivElement | null;
    const showInlayWindowsContainerElement = document.getElementById('show-inlay-windows-container') as HTMLDivElement | null;
    if (showInlayWindowsContainerElement) {
        showInlayWindowsContainerElement.style.display = focusTree.inlayWindows.length > 0 ? 'flex' : 'none';
    }
    if (inlayWindowsContainerElement) {
        inlayWindowsContainerElement.style.display = focusTree.inlayWindows.length > 0 ? 'block' : 'none';
    }
    if (inlayWindowsElement) {
        inlayWindowsElement.innerHTML = focusTree.inlayWindows.map(inlay => `<option value="${inlay.id}">${inlay.id}</option>`).join('');
        const selectedInlayWindowId = getSelectedInlayWindowId(focusTree);
        if (selectedInlayWindowId) {
            inlayWindowsElement.value = selectedInlayWindowId;
            setSelectedInlayWindowId(focusTree, selectedInlayWindowId);
        }
    }

    const warnings = document.getElementById('warnings') as HTMLTextAreaElement | null;
    if (warnings) {
        warnings.value = focusTree.warnings.length === 0 ? 'No warnings.' :
            focusTree.warnings.map(w => `[${w.source}] ${w.text}`).join('\n');
    }
}

function getFocusIcon(focus: Focus, exprs: ConditionItem[], styleTable: StyleTable): string {
    for (const icon of focus.icon) {
        if (applyCondition(icon.condition, exprs)) {
            const iconName = icon.icon;
            return styleTable.name('focus-icon-' + normalizeForStyle(iconName ?? '-empty'));
        }
    }

    return styleTable.name('focus-icon-' + normalizeForStyle('-empty'));
}

function focusToGridItem(
    focus: Focus,
    focusTree: FocusTree,
    allowBranchOptionsValue: Record<string, boolean>,
    positionByFocusId: Record<string, NumberPosition>,
    exprs: ConditionItem[],
): GridBoxItem | undefined {
    if (useConditionInFocus && allowBranchOptionsValue[focus.id] === false) {
        return undefined;
    }

    const classNames = focus.inAllowBranch.map(v => 'inbranch_' + v).join(' ');
    const connections: GridBoxConnection[] = [];

    for (const prerequisites of focus.prerequisite) {
        const style = prerequisites.length > 1 ? "1px dashed #88aaff" : "1px solid #88aaff";

        prerequisites.forEach(p => {
            const fp = focusTree.focuses[p];
            const classNames2 = fp?.inAllowBranch.map(v => 'inbranch_' + v).join(' ') ?? '';
            connections.push({
                target: p,
                targetType: 'parent',
                style: style,
                classNames: classNames + ' ' + classNames2,
            });
        });
    }

    focus.exclusive.forEach(e => {
        const fe = focusTree.focuses[e];
        const classNames2 = fe?.inAllowBranch.map(v => 'inbranch_' + v).join(' ') ?? '';
        connections.push({
            target: e,
            targetType: 'related',
            style: "1px solid red",
            classNames: classNames + ' ' + classNames2,
        });
    });

    const position = getFocusPosition(focus, positionByFocusId, focusTree, exprs);

    return {
        id: focus.id,
        htmlId: 'focus_' + focus.id,
        classNames: classNames + ' focus',
        gridX: position.x,
        gridY: position.y,
        connections,
    };
}

function clearCheckedFocuses() {
    for (const focusId in checkedFocuses) {
        checkedFocuses[focusId].dispose();
    }
    checkedFocuses = {};
}

function setupCheckedFocuses(focuses: Focus[], focusTree: FocusTree) {
    const focusCheckState = getState().checkedFocuses ?? {};
    for (const focus of focuses) {
        const checkbox = document.getElementById(`checkbox-${normalizeForStyle(focus.id)}`) as HTMLInputElement;
        if (checkbox) {
            if (focusTree.conditionExprs.some(e => e.scopeName === '' && e.nodeContent === 'has_completed_focus = ' + focus.id)) {
                checkbox.checked = !!focusCheckState[focus.id];
                const checkboxItem = new Checkbox(checkbox);
                checkedFocuses[focus.id] = checkboxItem;
                checkbox.addEventListener('change', async () => {
                    if (checkbox.checked) {
                        for (const exclusiveFocus of focus.exclusive) {
                            const exclusiveCheckbox = checkedFocuses[exclusiveFocus];
                            if (exclusiveCheckbox) {
                                exclusiveCheckbox.input.checked = false;
                                focusCheckState[exclusiveFocus] = false;
                            }
                        }
                    }
                    focusCheckState[focus.id] = checkbox.checked;
                    setState({ checkedFocuses: focusCheckState });

                    const rect = checkbox.getBoundingClientRect();
                    const oldLeft = rect.left;
                    const oldTop = rect.top;
                    await buildContent();

                    const newCheckbox = document.getElementById(`checkbox-${normalizeForStyle(focus.id)}`) as HTMLInputElement;
                    if (newCheckbox) {
                        const newRect = newCheckbox.getBoundingClientRect();
                        window.scrollBy(newRect.left - oldLeft, newRect.top - oldTop);
                    }

                    retriggerSearch();
                });
            } else {
                checkbox.parentElement?.remove();
            }
        }
    }
}

function dedupeConditionExprs(exprs: ConditionItem[]): ConditionItem[] {
    const result: ConditionItem[] = [];
    for (const expr of exprs) {
        if (!result.some(existing => existing.scopeName === expr.scopeName && existing.nodeContent === expr.nodeContent)) {
            result.push(expr);
        }
    }

    return result;
}

function renderInlayWindows(focusTree: FocusTree, exprs: ConditionItem[]): string {
    if (!showInlayWindows()) {
        return '';
    }

    const selectedInlayWindowId = getSelectedInlayWindowId(focusTree);
    if (!selectedInlayWindowId) {
        return '';
    }

    const selectedInlayWindow = focusTree.inlayWindows.find(inlay => inlay.id === selectedInlayWindowId);
    if (!selectedInlayWindow || !applyCondition(selectedInlayWindow.visible, exprs)) {
        return '';
    }

    const renderedInlayWindows: Record<string, string> = (window as any).renderedInlayWindows ?? {};
    const template = renderedInlayWindows[selectedInlayWindow.id] ?? '';
    return selectedInlayWindow.scriptedImages.reduce((content, slot) => {
        const activeOption = getActiveInlayOption(slot.gfxOptions, exprs);
        return content.split(`{{inlay_slot_class:${slot.id}}}`).join(activeOption ? getInlayGfxClassName(activeOption.gfxName, activeOption.gfxFile) : '');
    }, template);
}

function getActiveInlayOption<T extends { condition: any }>(options: T[], exprs: ConditionItem[]): T | undefined {
    for (const option of options) {
        if (applyCondition(option.condition, exprs)) {
            return option;
        }
    }

    return undefined;
}

function getInlayGfxClassName(gfxName: string | undefined, gfxFile: string | undefined): string {
    return 'st-inlay-gfx-' + normalizeForStyle((gfxFile ?? 'missing') + '-' + (gfxName ?? 'missing'));
}

let retriggerSearch: () => void = () => {};

window.addEventListener('load', tryRun(async function() {
    window.addEventListener('message', event => {
        const message = event.data as { command?: string; documentVersion?: number; focusId?: string; targetLocalX?: number; targetLocalY?: number };
        if (message.command !== 'focusPositionEditApplied') {
            return;
        }

        focusPositionDocumentVersion = message.documentVersion ?? focusPositionDocumentVersion;
        if (message.focusId !== undefined && message.targetLocalX !== undefined && message.targetLocalY !== undefined) {
            updateFocusPositionAfterApply(message.focusId, message.targetLocalX, message.targetLocalY);
        }

        void buildContent().then(() => {
            retriggerSearch();
        });
    });

    setupFocusPositionDragHandlers();
    setupFocusTemplateCreateHandler();

    const showInlayWindowsElement = document.getElementById('show-inlay-windows') as HTMLInputElement | null;
    if (showInlayWindowsElement) {
        (window as any).__showInlayWindows = !!getState().showInlayWindows;
        showInlayWindowsElement.checked = !!(window as any).__showInlayWindows;
        showInlayWindowsElement.addEventListener('change', async () => {
            (window as any).__showInlayWindows = showInlayWindowsElement.checked;
            setState({ showInlayWindows: showInlayWindowsElement.checked });
            updateSelectedFocusTree(false);
            await buildContent();
            retriggerSearch();
        });
    }

    const focusesElement = document.getElementById('focuses') as HTMLSelectElement | null;
    if (focusesElement) {
        focusesElement.value = selectedFocusTreeIndex.toString();
        focusesElement.addEventListener('change', async () => {
            selectedFocusTreeIndex = parseInt(focusesElement.value);
            setState({ selectedFocusTreeIndex });
            updateSelectedFocusTree(true);
            await buildContent();
            retriggerSearch();
        });
    }

    const inlayWindowsElement = document.getElementById('inlay-windows') as HTMLSelectElement | null;
    if (inlayWindowsElement) {
        inlayWindowsElement.addEventListener('change', async () => {
            const focusTree = focusTrees[selectedFocusTreeIndex];
            setSelectedInlayWindowId(focusTree, inlayWindowsElement.value);
            await buildContent();
            retriggerSearch();
        });
    }

    if (!useConditionInFocus) {
        const hiddenBranches = getState().hiddenBranches || {};
        for (const key in hiddenBranches) {
            showBranch(false, key);
        }

        const allowBranchesElement = document.getElementById('allowbranch') as HTMLDivElement | null;
        if (allowBranchesElement) {
            allowBranches = new DivDropdown(allowBranchesElement, true);
            allowBranches.selectAll();

            const allValues = allowBranches.selectedValues$.value;
            allowBranches.selectedValues$.next(allValues.filter(v => !hiddenBranches[v]));

            let oldSelection = allowBranches.selectedValues$.value;
            allowBranches.selectedValues$.subscribe(selection => {
                const showBranches = difference(selection, oldSelection);
                showBranches.forEach(s => showBranch(true, s));
                const hideBranches = difference(oldSelection, selection);
                hideBranches.forEach(s => showBranch(false, s));
                oldSelection = selection;

                const hiddenBranches = difference(allValues, selection);
                setState({ hiddenBranches });
            });
        }
    }

    const searchbox = document.getElementById('searchbox') as HTMLInputElement;
    let currentNavigatedIndex = 0;
    let oldSearchboxValue: string = getState().searchboxValue || '';
    let searchedFocus: HTMLDivElement[] = search(oldSearchboxValue, false);

    searchbox.value = oldSearchboxValue;

    const searchboxChangeFunc = function(this: HTMLInputElement) {
        const searchboxValue = this.value.toLowerCase();
        if (oldSearchboxValue !== searchboxValue) {
            currentNavigatedIndex = 0;
            searchedFocus = search(searchboxValue);
            oldSearchboxValue = searchboxValue;
            setState({ searchboxValue });
        }
    };

    searchbox.addEventListener('change', searchboxChangeFunc);
    searchbox.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            const visibleSearchedFocus = searchedFocus.filter(f => f.style.display !== 'none');
            if (visibleSearchedFocus.length > 0) {
                currentNavigatedIndex = (currentNavigatedIndex + (e.shiftKey ? visibleSearchedFocus.length - 1 : 1)) % visibleSearchedFocus.length;
                visibleSearchedFocus[currentNavigatedIndex].scrollIntoView({ block: "center", inline: "center" });
            }
        } else {
            searchboxChangeFunc.apply(this);
        }
    });
    searchbox.addEventListener('keyup', searchboxChangeFunc);
    searchbox.addEventListener('paste', searchboxChangeFunc);
    searchbox.addEventListener('cut', searchboxChangeFunc);

    retriggerSearch = () => { searchedFocus = search(oldSearchboxValue, false); };

    if (useConditionInFocus) {
        const conditionsElement = document.getElementById('conditions') as HTMLDivElement | null;
        if (conditionsElement) {
            conditions = new DivDropdown(conditionsElement, true);

            conditions.selectedValues$.next(selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
            conditions.selectedValues$.subscribe(async (selection) => {
                selectedExprs = selection.map<ConditionItem>(selection => {
                    const index = selection.indexOf('!|');
                    if (index === -1) {
                        return {
                            scopeName: '',
                            nodeContent: selection,
                        };
                    }

                    return {
                        scopeName: selection.substring(0, index),
                        nodeContent: selection.substring(index + 2),
                    };
                });

                setState({ selectedExprs });

                await buildContent();
                retriggerSearch();
            });
        }

        const inlayConditionsElement = document.getElementById('inlay-conditions') as HTMLDivElement | null;
        if (inlayConditionsElement) {
            inlayConditions = new DivDropdown(inlayConditionsElement, true);

            inlayConditions.selectedValues$.next(selectedInlayExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
            inlayConditions.selectedValues$.subscribe(async (selection) => {
                selectedInlayExprs = selection.map<ConditionItem>(selection => {
                    const index = selection.indexOf('!|');
                    if (index === -1) {
                        return {
                            scopeName: '',
                            nodeContent: selection,
                        };
                    }

                    return {
                        scopeName: selection.substring(0, index),
                        nodeContent: selection.substring(index + 2),
                    };
                });

                setState({ selectedInlayExprs });

                await buildContent();
                retriggerSearch();
            });
        }
    }

    const contentElement = document.getElementById('focustreecontent') as HTMLDivElement;
    enableZoom(contentElement, 0, 40);
    setPreviewPanDisabled(focusPositionEditMode);

    const focusPositionEditButton = document.getElementById('focus-position-edit') as HTMLButtonElement | null;
    focusPositionEditButton?.addEventListener('click', async () => {
        setFocusPositionEditMode(!focusPositionEditMode);
        await buildContent();
        retriggerSearch();
    });

    const showWarnings = document.getElementById('show-warnings') as HTMLButtonElement;
    if (showWarnings) {
        const warnings = document.getElementById('warnings-container') as HTMLDivElement;
        showWarnings.addEventListener('click', () => {
            const visible = warnings.style.display === 'block';
            document.body.style.overflow = visible ? '' : 'hidden';
            warnings.style.display = visible ? 'none' : 'block';
        });
    }

    updateSelectedFocusTree(false);
    await buildContent();
    scrollToState();
}));
