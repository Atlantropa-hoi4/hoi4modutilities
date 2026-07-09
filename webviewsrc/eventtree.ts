import { runSafely, enableZoom } from "./util/common";
import { vscode } from "./util/vscode";

const searchMatchClass = 'event-preview-search-match';
const searchCurrentClass = 'event-preview-search-current';
const hoverPictureViewportPadding = 12;

window.addEventListener('load', runSafely(async function() {
    const contentElement = document.getElementById('eventtreecontent') as HTMLDivElement;
    enableZoom(contentElement, 0, 0);

    showPictureWhenHover();
    enableEventNavigation();
    enableEventSearch();
}));

function enableEventNavigation() {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-event-preview-node]'));

    for (const node of nodes) {
        node.addEventListener('click', event => {
            event.stopPropagation();
            navigateToNode(node);
        });
        node.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();
            navigateToNode(node);
        });
    }
}

function enableEventSearch(): void {
    const toolbar = document.getElementById('event-tree-toolbar') as HTMLElement | null;
    const searchInput = document.getElementById('event-tree-search') as HTMLInputElement | null;
    const countElement = document.getElementById('event-tree-search-count') as HTMLElement | null;
    const previousButton = document.getElementById('event-tree-search-prev') as HTMLButtonElement | null;
    const nextButton = document.getElementById('event-tree-search-next') as HTMLButtonElement | null;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-event-preview-node]'));
    let matches: HTMLElement[] = [];
    let currentIndex = -1;

    if (!toolbar || !searchInput || !countElement || !previousButton || !nextButton) {
        return;
    }

    const searchBox = searchInput;
    const resultCount = countElement;
    const previousMatchButton = previousButton;
    const nextMatchButton = nextButton;

    toolbar.addEventListener('mousedown', event => event.stopPropagation());
    toolbar.addEventListener('click', event => event.stopPropagation());

    searchBox.addEventListener('input', updateMatches);
    searchBox.addEventListener('keydown', event => {
        if (event.key !== 'Enter') {
            return;
        }

        event.preventDefault();
        moveToMatch(event.shiftKey ? -1 : 1);
    });
    previousMatchButton.addEventListener('click', () => moveToMatch(-1));
    nextMatchButton.addEventListener('click', () => moveToMatch(1));

    updateMatches();

    function updateMatches() {
        for (const node of matches) {
            node.classList.remove(searchMatchClass, searchCurrentClass);
        }

        const query = searchBox.value.trim().toLocaleLowerCase();
        matches = query.length === 0
            ? []
            : nodes.filter(node => getSearchText(node).includes(query));
        currentIndex = matches.length > 0 ? 0 : -1;

        for (const node of matches) {
            node.classList.add(searchMatchClass);
        }

        updateCurrentMatch(false);
    }

    function moveToMatch(delta: number) {
        if (matches.length === 0) {
            return;
        }

        currentIndex = (currentIndex + delta + matches.length) % matches.length;
        updateCurrentMatch(true);
    }

    function updateCurrentMatch(scrollIntoView: boolean) {
        nodes.forEach(node => node.classList.remove(searchCurrentClass));

        const currentNode = getCurrentMatch();
        if (currentNode) {
            currentNode.classList.add(searchCurrentClass);
            if (scrollIntoView) {
                currentNode.focus();
                currentNode.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        }

        resultCount.textContent = matches.length > 0 ? `${currentIndex + 1}/${matches.length}` : '0/0';
        previousMatchButton.disabled = matches.length === 0;
        nextMatchButton.disabled = matches.length === 0;
    }

    function getCurrentMatch(): HTMLElement | undefined {
        return currentIndex >= 0 ? matches[currentIndex] : undefined;
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function getSearchText(node: HTMLElement): string {
    return (node.dataset.eventSearchText ?? '').toLocaleLowerCase();
}

function navigateToNode(node: HTMLElement) {
    navigateToSource(
        parseOptionalInteger(node.dataset.eventNavigateStart),
        parseOptionalInteger(node.dataset.eventNavigateEnd),
        node.dataset.eventNavigateFile,
    );
}

function navigateToSource(start: number | undefined, end: number | undefined, file: string | undefined) {
    if (start === undefined) {
        return;
    }

    vscode.postMessage({
        command: 'navigate',
        start,
        end,
        file,
    });
}

function parseOptionalInteger(value: string | undefined): number | undefined {
    if (value === undefined || value === '') {
        return undefined;
    }

    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
}

function showPictureWhenHover() {
    const eventNodes = document.getElementsByClassName('event-picture-host') as HTMLCollectionOf<HTMLDivElement>;
    for (let i = 0; i < eventNodes.length; i++) {
        const eventNode = eventNodes.item(i);
        if (eventNode) {
            showPictureWhenHoverElement(eventNode);
        }
    }
}

function showPictureWhenHoverElement(eventNode: HTMLDivElement) {
    const pictureKey = eventNode.attributes.getNamedItem('picture-style-key')?.value;
    const pictureWidthStr = eventNode.attributes.getNamedItem('picture-width')?.value;
    if (!pictureKey || !pictureWidthStr) {
        return;
    }

    const pictureWidth = parseInt(pictureWidthStr, 10);
    if (!Number.isFinite(pictureWidth)) {
        return;
    }

    let hoverElement: HTMLDivElement | undefined = undefined;

    eventNode.addEventListener('mouseenter', () => {
        hoverElement = document.createElement('div');
        hoverElement.className = pictureKey;
        hoverElement.style.position = 'fixed';
        hoverElement.style.left = '0';
        hoverElement.style.top = '0';
        hoverElement.style.zIndex = '20';
        hoverElement.style.pointerEvents = 'none';
        hoverElement.style.visibility = 'hidden';
        document.body.append(hoverElement);
        positionHoverPictureElement(eventNode, hoverElement, pictureWidth);
    });

    eventNode.addEventListener('mouseleave', () => {
        hoverElement?.remove();
        hoverElement = undefined;
    });
}

function positionHoverPictureElement(eventNode: HTMLDivElement, hoverElement: HTMLDivElement, pictureWidth: number): void {
    const anchor = eventNode.getBoundingClientRect();
    const originalWidth = hoverElement.offsetWidth || pictureWidth;
    const originalHeight = hoverElement.offsetHeight || originalWidth;
    const maxWidth = Math.max(48, window.innerWidth - hoverPictureViewportPadding * 2);
    const maxHeight = Math.max(48, window.innerHeight - hoverPictureViewportPadding * 2);
    const scale = Math.min(1, maxWidth / originalWidth, maxHeight / originalHeight);
    const width = Math.max(1, Math.floor(originalWidth * scale));
    const height = Math.max(1, Math.floor(originalHeight * scale));
    const belowTop = anchor.bottom + hoverPictureViewportPadding;
    const aboveTop = anchor.top - height - hoverPictureViewportPadding;
    const preferredTop = belowTop + height <= window.innerHeight - hoverPictureViewportPadding
        ? belowTop
        : aboveTop;
    const maxLeft = Math.max(hoverPictureViewportPadding, window.innerWidth - width - hoverPictureViewportPadding);
    const maxTop = Math.max(hoverPictureViewportPadding, window.innerHeight - height - hoverPictureViewportPadding);
    const left = clamp(anchor.left - (width - anchor.width) / 2, hoverPictureViewportPadding, maxLeft);
    const top = clamp(preferredTop, hoverPictureViewportPadding, maxTop);

    hoverElement.style.width = `${width}px`;
    hoverElement.style.height = `${height}px`;
    hoverElement.style.backgroundSize = '100% 100%';
    hoverElement.style.left = `${left}px`;
    hoverElement.style.top = `${top}px`;
    hoverElement.style.visibility = '';
}
