import { filterConditionPresetExprKeys } from '../../src/previewdef/focustree/conditionpresets';
import { focusTreeProtocolVersion, FocusTreeView } from '../../src/previewdef/focustree/viewmodel';
import { normalizeForStyle } from '../../src/util/styletable';
import { runSafely, setState } from '../util/common';
import { DivDropdown } from '../util/dropdown';
import { feLocalize } from '../util/i18n';
import { vscode } from '../util/vscode';
import { scheduleFocusAssetDemandCheck } from './assetloading';
import {
    conditionItemToExprKey,
    exprKeyToConditionItem,
    getConditionPresetsForTree,
    getSelectedConditionPreset,
    getSelectedExprKeys,
    getSelectedExprKeysForFocusTree,
    getTreeConditionExprKeys,
    refreshConditionPresetUi,
    replaceDivDropdownOptions,
    replaceSelectOptions,
    saveConditionPreset,
    setConditionPresetsForTree,
    setSelectedExprsFromExprKeys,
} from './conditions';
import { applyContinuousFocusElementPosition, applySearchFilters, rebuildContentSafely } from './content';
import { refreshInlayWindowSelector, setSelectedInlayWindowId } from './inlays';
import { runtime } from './runtime';
import { installSearchbox } from './search';
import {
    ensureSelectedFocusTreeIndex,
    getCurrentFocusTree,
    setSelectedFocusTreeByIndex,
} from './selection';
import { getHiddenBranches, setBranchVisibility } from './visualstate';

function refreshSearchFilterOptions(): void {
    const select = document.getElementById('search-filters') as HTMLDivElement | null;
    const container = document.getElementById('search-filters-container') as HTMLDivElement | null;
    const focusTree = getCurrentFocusTree();
    if (!select || !focusTree) {
        return;
    }
    const filters = focusTree.searchFilters ?? [];
    runtime.selectedSearchFilters = runtime.selectedSearchFilters.filter(filter => filters.includes(filter));
    replaceDivDropdownOptions(select, filters.map(filter => ({
        value: filter,
        text: focusTree.searchFilterLabels?.[filter] ?? filter,
    })));
    select.querySelectorAll<HTMLDivElement>('.option').forEach(option => {
        option.classList.add(`st-focus-icon-${normalizeForStyle(`GFX_${option.getAttribute('value') ?? ''}`)}`);
    });
    runtime.dropdowns.searchFilters?.selectedValues$.next(runtime.selectedSearchFilters);
    if (container) {
        container.style.display = filters.length > 0 ? 'flex' : 'none';
    }
}

/** Refreshes toolbar controls that depend on the selected tree's data. */
export function updateSelectedFocusTree(clearCondition: boolean): void {
    const focusTree = getCurrentFocusTree();
    if (!focusTree) {
        return;
    }
    applyContinuousFocusElementPosition(focusTree);
    refreshSearchFilterOptions();

    if (runtime.useConditionInFocus) {
        const conditionExprs = getTreeConditionExprKeys(focusTree).map(exprKeyToConditionItem);
        const nextSelectedExprKeys = getSelectedExprKeysForFocusTree(focusTree, clearCondition);
        setSelectedExprsFromExprKeys(nextSelectedExprKeys);

        const conditionContainerElement = document.getElementById('condition-container') as HTMLDivElement | null;
        if (conditionContainerElement) {
            conditionContainerElement.style.display = conditionExprs.length > 0 ? 'flex' : 'none';
        }

        const conditions = runtime.dropdowns.conditions;
        if (conditions) {
            replaceDivDropdownOptions(conditions.select, conditionExprs.map(option => ({
                value: conditionItemToExprKey(option),
                text: `${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}`,
            })));
            runtime.suppressConditionSelectionChange = true;
            conditions.selectedValues$.next(nextSelectedExprKeys);
            runtime.suppressConditionSelectionChange = false;
        }
        refreshConditionPresetUi(focusTree);
    } else {
        const presetContainerElement = document.getElementById('condition-preset-container') as HTMLDivElement | null;
        if (presetContainerElement) {
            presetContainerElement.style.display = 'none';
        }
        const allowBranchesContainerElement = document.getElementById('allowbranch-container') as HTMLDivElement | null;
        if (allowBranchesContainerElement) {
            allowBranchesContainerElement.style.display = focusTree.allowBranchOptions.length > 0 ? 'flex' : 'none';
        }

        const allowBranches = runtime.dropdowns.allowBranches;
        if (allowBranches) {
            replaceDivDropdownOptions(allowBranches.select, focusTree.allowBranchOptions.map(option => ({
                value: `inbranch_${option}`,
                text: option,
            })));
            allowBranches.selectAll();
        }
    }

    refreshInlayWindowSelector(focusTree);
    renderWarningsPanel(focusTree);
}

function getWarningPanelClassNames() {
    const template = document.getElementById('warnings-entry-template') as HTMLDivElement | null;
    return {
        entry: template?.dataset.warningEntryClass ?? '',
        entryMuted: template?.dataset.warningEntryMutedClass ?? '',
        meta: template?.dataset.warningMetaClass ?? '',
        text: template?.dataset.warningTextClass ?? '',
        warning: template?.dataset.warningWarningClass ?? '',
        info: template?.dataset.warningInfoClass ?? '',
    };
}

function renderWarningsPanel(focusTree: FocusTreeView): void {
    const warningsElement = document.getElementById('warnings') as HTMLDivElement | null;
    if (!warningsElement) {
        return;
    }

    if (focusTree.warnings.length === 0) {
        const noWarningsElement = document.createElement('div');
        noWarningsElement.textContent = feLocalize('TODO', 'No warnings.');
        warningsElement.replaceChildren(noWarningsElement);
        return;
    }

    const classes = getWarningPanelClassNames();
    const fragment = document.createDocumentFragment();
    focusTree.warnings.forEach((warning, index) => {
        const hasNavigation = !!warning.navigations?.length;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = [
            classes.entry,
            warning.severity === 'warning' ? classes.warning : classes.info,
            hasNavigation ? '' : classes.entryMuted,
        ].filter(Boolean).join(' ');
        button.dataset.warningIndex = index.toString();
        button.disabled = !hasNavigation;
        const meta = `[${warning.severity}][${warning.code}][${warning.kind}][${warning.source}]`;
        button.title = `${meta} ${warning.text}`;

        const metaElement = document.createElement('span');
        metaElement.className = classes.meta;
        metaElement.textContent = meta;
        const textElement = document.createElement('span');
        textElement.className = classes.text;
        textElement.textContent = warning.text;
        const navigationElement = document.createElement('span');
        navigationElement.className = classes.meta;
        navigationElement.textContent = hasNavigation
            ? feLocalize('TODO', 'Navigate')
            : feLocalize('TODO', 'No navigation');

        button.append(metaElement, textElement, navigationElement);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const navigation = warning.navigations?.[0];
            if (!navigation) {
                return;
            }
            vscode.postMessage({
                command: 'navigate',
                start: navigation.start,
                end: navigation.end,
                file: navigation.file,
                select: false,
                documentVersion: runtime.focusPositionDocumentVersion,
            });
        });
        fragment.appendChild(button);
    });
    warningsElement.replaceChildren(fragment);
}

export function refreshFocusTreeSelectorOptions(): void {
    const selectorContainer = document.getElementById('focus-tree-selector-container') as HTMLDivElement | null;
    const focusesElement = document.getElementById('focuses') as HTMLSelectElement | null;
    ensureSelectedFocusTreeIndex();
    if (selectorContainer) {
        selectorContainer.style.display = runtime.focusTreeCatalog.length > 1 ? 'flex' : 'none';
    }
    refreshSearchFilterOptions();
    if (!focusesElement) {
        return;
    }

    replaceSelectOptions(focusesElement, runtime.focusTreeCatalog.map((focusTree, index) => ({
        value: index.toString(),
        text: focusTree.id,
    })));
    focusesElement.value = runtime.selectedFocusTreeIndex.toString();
}

export function refreshWarningsButtonVisibility(): void {
    const showWarningsButton = document.getElementById('show-warnings') as HTMLButtonElement | null;
    if (!showWarningsButton) {
        return;
    }

    const hasWarnings = runtime.focusTreeCatalog.some(focusTree => focusTree.warningCount > 0);
    showWarningsButton.style.display = hasWarnings ? '' : 'none';
    if (!hasWarnings) {
        const warnings = document.getElementById('warnings-container') as HTMLDivElement | null;
        if (warnings) {
            warnings.style.display = 'none';
        }
        document.body.style.overflow = '';
    }
}

let lastSceneRequestKey: string | undefined;

function requestFocusTreeScene(treeId: string): void {
    lastSceneRequestKey = `${treeId}\u0000${runtime.snapshotVersion}\u0000${runtime.focusPositionDocumentVersion}`;
    vscode.postMessage({
        command: 'focusTreeSceneRequest',
        protocolVersion: focusTreeProtocolVersion,
        requestId: runtime.latestRequestId,
        snapshotVersion: runtime.snapshotVersion,
        documentVersion: runtime.focusPositionDocumentVersion,
        sceneRevision: runtime.snapshotVersion,
        treeId,
    });
}

/** Asks the host for the current view of a tree, e.g. after a delta could not be applied. */
export function requestCurrentFocusTreeScene(): void {
    const treeId = runtime.selectedFocusTreeId;
    if (treeId) {
        requestFocusTreeScene(treeId);
    }
}

/**
 * Requests the selected catalog tree again when host content arrived without it. The host
 * drops scene requests made while a refresh changes the document; one request per snapshot.
 */
export function requestSelectedFocusTreeSceneIfMissing(): void {
    const treeId = runtime.selectedFocusTreeId;
    if (!treeId
        || runtime.focusTrees.some(tree => tree.id === treeId)
        || !runtime.focusTreeCatalog.some(tree => tree.id === treeId)
        || lastSceneRequestKey === `${treeId}\u0000${runtime.snapshotVersion}\u0000${runtime.focusPositionDocumentVersion}`) {
        return;
    }
    requestFocusTreeScene(treeId);
}

function installTreeSelector(): void {
    const focusesElement = document.getElementById('focuses') as HTMLSelectElement | null;
    if (!focusesElement) {
        return;
    }
    refreshFocusTreeSelectorOptions();
    focusesElement.addEventListener('change', runSafely(async () => {
        setSelectedFocusTreeByIndex(parseInt(focusesElement.value, 10));
        if (!getCurrentFocusTree() && runtime.selectedFocusTreeId) {
            requestFocusTreeScene(runtime.selectedFocusTreeId);
            return;
        }
        updateSelectedFocusTree(true);
        await rebuildContentSafely();
    }));
}

function installInlayWindowSelector(): void {
    const inlayWindowsElement = document.getElementById('inlay-windows') as HTMLDivElement | null;
    if (!inlayWindowsElement) {
        return;
    }
    const inlayWindows = new DivDropdown(inlayWindowsElement);
    runtime.dropdowns.inlayWindows = inlayWindows;
    let previousSelection = inlayWindows.selectedValues$.value[0];
    inlayWindows.selectedValues$.subscribe(runSafely(async selection => {
        const focusTree = getCurrentFocusTree();
        const nextSelection = selection[0];
        if (runtime.suppressInlayWindowSelectionChange) {
            previousSelection = nextSelection;
            return;
        }
        if (!focusTree || previousSelection === nextSelection) {
            return;
        }

        previousSelection = nextSelection;
        setSelectedInlayWindowId(focusTree, nextSelection);
        await rebuildContentSafely();
    }));
}

function installAllowBranchSelector(): void {
    const hiddenBranches = getHiddenBranches();
    for (const branchClass of Object.keys(hiddenBranches)) {
        setBranchVisibility(false, branchClass);
    }

    const allowBranchesElement = document.getElementById('allowbranch') as HTMLDivElement | null;
    if (!allowBranchesElement) {
        return;
    }
    const allowBranches = new DivDropdown(allowBranchesElement, true);
    runtime.dropdowns.allowBranches = allowBranches;
    allowBranches.selectAll();
    allowBranches.selectedValues$.next(allowBranches.selectedValues$.value.filter(value => !hiddenBranches[value]));

    let oldSelection = allowBranches.selectedValues$.value;
    allowBranches.selectedValues$.subscribe(selection => {
        const selected = new Set(selection);
        const previous = new Set(oldSelection);
        const shown = selection.filter(value => !previous.has(value));
        shown.forEach(value => setBranchVisibility(true, value));
        oldSelection.filter(value => !selected.has(value)).forEach(value => setBranchVisibility(false, value));
        oldSelection = selection;
        if (shown.length > 0) {
            // Shown branches can reveal focuses whose icons are not loaded yet.
            scheduleFocusAssetDemandCheck(true);
        }
    });
}

function installSearchFilterSelector(): void {
    const searchFiltersElement = document.getElementById('search-filters') as HTMLDivElement | null;
    if (!searchFiltersElement) {
        return;
    }
    const searchFilters = new DivDropdown(searchFiltersElement, true, {
        empty: feLocalize('combobox.all', '(All)'),
    });
    runtime.dropdowns.searchFilters = searchFilters;
    refreshSearchFilterOptions();
    searchFilters.selectedValues$.subscribe(selection => {
        runtime.selectedSearchFilters = [...selection];
        setState({ selectedSearchFilters: runtime.selectedSearchFilters });
        applySearchFilters();
    });
}

function installConditionSelectors(): void {
    const conditionPresetsElement = document.getElementById('condition-presets') as HTMLDivElement | null;
    if (conditionPresetsElement) {
        const conditionPresets = new DivDropdown(conditionPresetsElement);
        runtime.dropdowns.conditionPresets = conditionPresets;
        conditionPresets.selectedValues$.subscribe(runSafely(async selection => {
            if (runtime.suppressConditionPresetSelectionChange) {
                return;
            }

            const focusTree = getCurrentFocusTree();
            const nextSelection = selection[0];
            if (!focusTree) {
                return;
            }
            const preset = nextSelection && nextSelection !== '__custom__'
                ? getConditionPresetsForTree(focusTree.id).find(currentPreset => currentPreset.id === nextSelection)
                : undefined;
            if (!preset) {
                refreshConditionPresetUi(focusTree);
                return;
            }

            const filteredExprKeys = filterConditionPresetExprKeys(preset.exprKeys, getTreeConditionExprKeys(focusTree));
            setSelectedExprsFromExprKeys(filteredExprKeys);
            if (runtime.dropdowns.conditions) {
                runtime.suppressConditionSelectionChange = true;
                runtime.dropdowns.conditions.selectedValues$.next(filteredExprKeys);
                runtime.suppressConditionSelectionChange = false;
            }
            refreshConditionPresetUi(focusTree);
            await rebuildContentSafely();
        }));
    }

    document.getElementById('save-condition-preset')?.addEventListener('click', () => {
        const focusTree = getCurrentFocusTree();
        if (!focusTree) {
            return;
        }

        runtime.pendingConditionPresetTargetTreeId = focusTree.id;
        runtime.pendingConditionPresetExprKeys = getSelectedExprKeys();
        vscode.postMessage({
            command: 'promptFocusConditionPresetName',
            initialValue: getSelectedConditionPreset(focusTree)?.name ?? '',
        });
    });

    document.getElementById('delete-condition-preset')?.addEventListener('click', runSafely(async () => {
        const focusTree = getCurrentFocusTree();
        const selectedPreset = focusTree ? getSelectedConditionPreset(focusTree) : undefined;
        if (!focusTree || !selectedPreset) {
            return;
        }

        setConditionPresetsForTree(
            focusTree.id,
            getConditionPresetsForTree(focusTree.id).filter(preset => preset.id !== selectedPreset.id),
        );
        refreshConditionPresetUi(focusTree);
        await rebuildContentSafely();
    }));

    const conditionsElement = document.getElementById('conditions') as HTMLDivElement | null;
    if (conditionsElement) {
        const conditions = new DivDropdown(conditionsElement, true);
        runtime.dropdowns.conditions = conditions;
        conditions.selectedValues$.subscribe(runSafely(async selection => {
            if (runtime.suppressConditionSelectionChange) {
                return;
            }

            const focusTree = getCurrentFocusTree();
            if (!focusTree) {
                return;
            }

            setSelectedExprsFromExprKeys(selection);
            refreshConditionPresetUi(focusTree);
            await rebuildContentSafely();
        }));
    }
}

/** Applies a preset name chosen in the host's input box. */
export function handleConditionPresetNameResolved(name: string | undefined): void {
    const presetName = name?.trim();
    const targetTreeId = runtime.pendingConditionPresetTargetTreeId;
    const exprKeys = runtime.pendingConditionPresetExprKeys;
    runtime.pendingConditionPresetTargetTreeId = undefined;
    runtime.pendingConditionPresetExprKeys = [];
    if (!presetName || !targetTreeId) {
        return;
    }

    saveConditionPreset(targetTreeId, presetName, exprKeys);
    const focusTree = getCurrentFocusTree();
    if (focusTree && focusTree.id === targetTreeId) {
        refreshConditionPresetUi(focusTree);
    }
}

export function installToolbar(): void {
    installTreeSelector();
    installInlayWindowSelector();
    if (!runtime.useConditionInFocus) {
        installAllowBranchSelector();
    }
    installSearchbox();
    installSearchFilterSelector();
    if (runtime.useConditionInFocus) {
        installConditionSelectors();
    }

    const showWarnings = document.getElementById('show-warnings') as HTMLButtonElement | null;
    const warnings = document.getElementById('warnings-container') as HTMLDivElement | null;
    if (showWarnings && warnings) {
        showWarnings.addEventListener('click', () => {
            const visible = warnings.style.display === 'block';
            document.body.style.overflow = visible ? '' : 'hidden';
            warnings.style.display = visible ? 'none' : 'block';
        });
    }
}
