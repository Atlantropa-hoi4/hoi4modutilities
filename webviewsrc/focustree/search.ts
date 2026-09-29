import { setState } from '../util/common';
import { runtime } from './runtime';
import { focusScene } from './scenestore';
import { isFocusBranchHidden, updateSearchMatchClasses } from './visualstate';

let searchValue = runtime.initialSearchboxValue;
let searchedFocus: HTMLElement[] = [];
let navigatedIndex = 0;

/** Marks focuses whose id or display name contains the query; optionally reveals the first. */
export function search(searchContent: string, navigate = true): HTMLElement[] {
    const normalizedSearch = searchContent.trim().toLowerCase();
    const nextResultIds = new Set<string>();
    if (normalizedSearch) {
        for (const [focusId, normalizedText] of Object.entries(runtime.searchTextByFocusId)) {
            if (normalizedText.includes(normalizedSearch)) {
                nextResultIds.add(focusId);
            }
        }
    }

    const firstResultId = nextResultIds.values().next().value as string | undefined;
    if (navigate && firstResultId) {
        focusScene.ensureMounted([firstResultId]);
    }

    const changedResultIds = new Set<string>();
    runtime.searchResultIds.forEach(focusId => {
        if (!nextResultIds.has(focusId)) {
            changedResultIds.add(focusId);
        }
    });
    nextResultIds.forEach(focusId => {
        if (!runtime.searchResultIds.has(focusId)) {
            changedResultIds.add(focusId);
        }
    });
    runtime.searchResultIds = nextResultIds;
    updateSearchMatchClasses(changedResultIds);

    const results = Array.from(nextResultIds)
        .map(focusId => focusScene.getWrapper(focusId))
        .filter((wrapper): wrapper is HTMLElement => !!wrapper);
    if (navigate) {
        results[0]?.scrollIntoView({ block: 'center', inline: 'center' });
    }
    return results;
}

export function retriggerSearch(): void {
    searchedFocus = search(searchValue, false);
}

export function installSearchbox(): void {
    const searchbox = document.getElementById('searchbox') as HTMLInputElement | null;
    searchedFocus = search(searchValue, false);
    if (!searchbox) {
        return;
    }

    searchbox.value = searchValue;
    const handleChange = () => {
        const nextValue = searchbox.value.toLowerCase();
        if (searchValue !== nextValue) {
            navigatedIndex = 0;
            searchedFocus = search(nextValue);
            searchValue = nextValue;
            setState({ searchboxValue: nextValue });
        }
    };

    searchbox.addEventListener('change', handleChange);
    searchbox.addEventListener('keypress', event => {
        if (event.key !== 'Enter') {
            handleChange();
            return;
        }

        const visibleResults = searchedFocus.filter(result => !isFocusBranchHidden(result));
        if (visibleResults.length > 0) {
            navigatedIndex = (navigatedIndex + (event.shiftKey ? visibleResults.length - 1 : 1)) % visibleResults.length;
            visibleResults[navigatedIndex].scrollIntoView({ block: 'center', inline: 'center' });
        }
    });
    searchbox.addEventListener('keyup', handleChange);
    searchbox.addEventListener('paste', handleChange);
    searchbox.addEventListener('cut', handleChange);
}
