import { setState } from '../util/common';
import { feLocalize } from '../util/i18n';
import { getFocusNavigationTargetById, navigateToFocus } from './navigation';
import { runtime } from './runtime';
import { focusScene } from './scenestore';
import { createFocusSearchScene, FocusSearchNavigator, matchFocusSearch } from './searchnavigation';
import { isHiddenBranchClass, updateSearchMatchClasses } from './visualstate';

let searchValue = runtime.initialSearchboxValue;

/**
 * Enter walks the current matches the scene shows, mounting a match's card before scrolling to
 * it; matches hidden by conditions or branches are skipped. Typing moves to the first match.
 */
const navigator = new FocusSearchNavigator(createFocusSearchScene(focusScene, isHiddenBranchClass));

/** Marks focuses whose id or display name contains the query; `navigate` moves to the first. */
export function search(searchContent: string, navigate = true): void {
    const nextResultIds = matchFocusSearch(runtime.searchTextByFocusId, searchContent);
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
    navigator.setResults(nextResultIds, navigate);
    applySearchPosition();
}

export function retriggerSearch(): void {
    search(searchValue, false);
}

/** Recounts the walkable matches after branch visibility changed without a rebuild. */
export function refreshSearchNavigation(): void {
    navigator.refresh();
    applySearchPosition();
}

function applySearchPosition(): void {
    const previous = runtime.currentSearchResultId;
    runtime.currentSearchResultId = navigator.current;
    if (previous !== runtime.currentSearchResultId) {
        updateSearchMatchClasses([previous, runtime.currentSearchResultId].filter((focusId): focusId is string => !!focusId));
    }

    const count = document.getElementById('focus-search-count');
    if (!count) {
        return;
    }
    const position = navigator.getPosition();
    const text = !searchValue.trim()
        ? ''
        : position.total === 0
            ? feLocalize('focustree.search.nomatches', 'no matches')
            : feLocalize('focustree.search.matches', '{0}/{1}', position.current ?? '-', position.total);
    if (count.textContent !== text) {
        count.textContent = text;
    }
}

export function installSearchbox(): void {
    const searchbox = document.getElementById('searchbox') as HTMLInputElement | null;
    search(searchValue, false);
    if (!searchbox) {
        return;
    }

    searchbox.value = searchValue;
    const handleChange = () => {
        const nextValue = searchbox.value.toLowerCase();
        if (searchValue !== nextValue) {
            searchValue = nextValue;
            search(nextValue);
            setState({ searchboxValue: nextValue });
        }
    };

    searchbox.addEventListener('input', event => {
        // Text an IME is still composing is searched once compositionend commits it.
        if (!(event as InputEvent).isComposing) {
            handleChange();
        }
    });
    searchbox.addEventListener('compositionend', handleChange);
    searchbox.addEventListener('change', handleChange);
    searchbox.addEventListener('keydown', event => {
        // Enter that commits an IME composition is not a search step.
        if (event.key !== 'Enter' || event.isComposing) {
            return;
        }
        event.preventDefault();
        if (event.altKey) {
            // Opens the current match in the editor, the keyboard counterpart of clicking its card.
            const focusId = navigator.ensureCurrent();
            applySearchPosition();
            if (focusId) {
                navigateToFocus(getFocusNavigationTargetById(focusId));
            }
            return;
        }
        navigator.step(event.shiftKey);
        applySearchPosition();
    });
}
