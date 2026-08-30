import { enableDropdowns, numDropDownOpened$ } from './dropdown';
import { enableCheckboxes } from './checkbox';
import { vscode } from './vscode';
import { sendException } from './telemetry';
import { forceError } from '../../src/util/common';
import { normalizePreviewScale } from '../../src/util/previewscale';
import { BehaviorSubject } from 'rxjs';
export { arrayToMap } from '../../src/util/common';

export const panning$ = new BehaviorSubject<boolean>(false);

export function setState(obj: Record<string, any>): void {
    const state = getState();
    Object.assign(state, obj);
    vscode.setState(state);
}

export function getState(): Record<string, any> {
    return vscode.getState() || {};
}

export function scrollToState() {
    const state = getState();
    const xOffset = state.xOffset || 0;
    const yOffset = state.yOffset || 0;
    window.scroll(xOffset, yOffset);
}

function isPreviewPanDisabled(): boolean {
    return document.body?.dataset.disablePreviewPan === 'true';
}

let previewPanStartX = -1;
let previewPanStartY = -1;
let previewPanPressed = false;

function setPreviewPanPressed(pressed: boolean): void {
    previewPanPressed = pressed;
    document.body?.classList.toggle('panning', pressed);
    if (panning$.value !== pressed) {
        panning$.next(pressed);
    }
}

export function setPreviewPanDisabled(disabled: boolean): void {
    if (!document.body) {
        return;
    }

    document.body.dataset.disablePreviewPan = disabled ? 'true' : 'false';

    const dragger = document.getElementById('dragger') as HTMLDivElement | null;
    if (dragger) {
        dragger.style.pointerEvents = disabled ? 'none' : '';
        dragger.style.cursor = disabled ? 'default' : '';
    }
}

export function startPreviewPan(pageX: number, pageY: number, force = false): void {
    if (!force && isPreviewPanDisabled()) {
        setPreviewPanPressed(false);
        return;
    }

    previewPanStartX = pageX;
    previewPanStartY = pageY;
    setPreviewPanPressed(true);
}

export function copyArray<T>(src: T[], dst: T[], offsetSrc: number, offsetDst: number, length: number): void {
    for (let i = offsetSrc, j = offsetDst, k = 0; k < length; i++, j++, k++) {
        dst[j] = src[i];
    }
}

export function subscribeNavigators(root: ParentNode = document) {
    const navigators = root.querySelectorAll('.navigator');
    for (const navigatorElement of Array.from(navigators)) {
        const navigator = navigatorElement as HTMLDivElement;
        if (navigator.dataset.navigatorBound === 'true') {
            continue;
        }

        navigator.dataset.navigatorBound = 'true';
        navigator.addEventListener('click', function(e) {
            e.stopPropagation();
            const startStr = this.attributes.getNamedItem('start')?.value;
            const endStr = this.attributes.getNamedItem('end')?.value;
            const file = this.attributes.getNamedItem('file')?.value;
            const start = !startStr || startStr === 'undefined' ? undefined : parseInt(startStr);
            const end = !endStr ? undefined : parseInt(endStr);
            const focusId = this.dataset.focusId || undefined;
            const documentVersion = typeof (window as any).focusPositionDocumentVersion === 'number'
                ? (window as any).focusPositionDocumentVersion
                : undefined;
            navigateText(start, end, file, focusId, documentVersion);
        });
    }
}

export function tryRun<T extends (...args: any[]) => any>(func: T): (...args: Parameters<T>) => ReturnType<T> | undefined {
    return function(this: any, ...args) {
        try {
            const result = func.apply(this, args);
            if (result instanceof Promise) {
                return result.catch(reportRunError) as ReturnType<T>;
            }

            return result;

        } catch (e) {
            reportRunError(e);
        }

        return undefined;
    };
}

export function runSafely<T extends (...args: any[]) => unknown>(func: T): (...args: Parameters<T>) => void {
    return function(this: any, ...args): void {
        try {
            const result = func.apply(this, args);
            if (result instanceof Promise) {
                void result.catch(reportRunError);
            }
        } catch (e) {
            reportRunError(e);
        }
    };
}

function reportRunError(error: unknown): void {
    console.error(error);
    sendException(forceError(error));
}

let shouldDisableZoom = false;
export function currentScale(): number {
    return normalizePreviewScale(getState().scale);
}

export function enableZoom(contentElement: HTMLDivElement, xOffset: number, yOffset: number): void {
    const restoredScale = getState().scale;
    let scale = normalizePreviewScale(restoredScale);
    if (restoredScale !== undefined && restoredScale !== scale) {
        setState({ scale });
    }
    contentElement.style.transform = `scale(${scale})`;
    contentElement.style.transformOrigin = '0 0';
    window.addEventListener('wheel', function(e) {
        if (shouldDisableZoom) {
            return;
        }

        e.preventDefault();
        const oldScale = scale;

        if (e.deltaY > 0) {
            scale = Math.max(0.2, scale - 0.2);
        } else if (e.deltaY < 0) {
            scale = Math.min(1, scale + 0.2);
        }

        const oldScrollX = window.scrollX;
        const oldScrollY = window.scrollY;
        
        contentElement.style.transform = `scale(${scale})`;
        setState({ scale });

        const nextScrollX = (e.pageX - xOffset) * scale / oldScale + xOffset - (e.pageX - oldScrollX);
        const nextScrollY = (e.pageY - yOffset) * scale / oldScale + yOffset - (e.pageY - oldScrollY);
        window.scrollTo(nextScrollX, nextScrollY);
    },
    {
        passive: false
    });
}

function navigateText(
    start: number | undefined,
    end: number | undefined,
    file: string | undefined,
    focusId?: string,
    documentVersion?: number,
): void {
    vscode.postMessage({
        command: 'navigate',
        start,
        end,
        file,
        focusId,
        documentVersion,
    });
};

export function subscribeRefreshButton() {
    const button = document.getElementById('refresh') as HTMLButtonElement;
    button?.addEventListener('click', function() {
        vscode.postMessage({ command: 'reload' });
        button.disabled = true;
    });
}

export type PreviewLabelMode = 'id' | 'name';

export function subscribePreviewLabelToggle(defaultMode: PreviewLabelMode = 'id'): void {
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-preview-label-mode-value]'));
    if (controls.length === 0) {
        return;
    }

    const restoredMode = getState().previewLabelMode;
    const initialMode: PreviewLabelMode = restoredMode === 'id' || restoredMode === 'name'
        ? restoredMode
        : defaultMode;
    applyPreviewLabelMode(initialMode);

    for (const control of controls) {
        control.addEventListener('click', () => {
            const mode = control.dataset.previewLabelModeValue === 'name' ? 'name' : 'id';
            applyPreviewLabelMode(mode);
        });
    }
}

export function refreshPreviewLabelMode(): void {
    const mode = document.body.dataset.previewLabelMode === 'name' ? 'name' : 'id';
    applyPreviewLabelMode(mode);
}

/** Compatibility entrypoint for previews that explicitly initialise the shared module. */
export function initCommon(): void {
    // This fork registers the shared load handlers when the module is evaluated.
}

function applyPreviewLabelMode(mode: PreviewLabelMode): void {
    document.body.dataset.previewLabelMode = mode;
    setState({ previewLabelMode: mode });

    for (const control of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-preview-label-mode-value]'))) {
        const active = control.dataset.previewLabelModeValue === mode;
        control.classList.toggle('active', active);
        control.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-preview-label-id][data-preview-label-name]'))) {
        element.textContent = mode === 'name'
            ? element.dataset.previewLabelName ?? element.dataset.previewLabelId ?? ''
            : element.dataset.previewLabelId ?? '';
    }

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-preview-title-id][data-preview-title-name]'))) {
        element.title = mode === 'name'
            ? element.dataset.previewTitleName ?? element.dataset.previewTitleId ?? ''
            : element.dataset.previewTitleId ?? '';
    }
}

if (window.previewedFileUri) {
    setState({ uri: window.previewedFileUri });
}

window.addEventListener('load', function() {
    // Disable selection
    document.body.style.userSelect = 'none';

    // Save scroll position
    (function() {
        scrollToState();

        window.addEventListener('scroll', function() {
            const state = getState();
            state.xOffset = window.pageXOffset;
            state.yOffset = window.pageYOffset;
            vscode.setState(state);
        });
    })();

    // Drag to scroll
    (function() {
        // Dragger should be like this: <div id="dragger" additionalDraggerHostId="optionalid" style="width:100vw;height:100vh;position:fixed;left:0;top:0;"></div>
        const dragger = document.getElementById("dragger");
        if (!dragger) {
            return;
        }

        const rightButtonDrag = (window as any).__featureflags?.rightButtonDrag ?? false;
        const button = rightButtonDrag ? 2 : 0;
        const buttonMask = rightButtonDrag ? 2 : 1;

        const hosts = [ dragger ];
        if (rightButtonDrag) {
            const hostId = dragger.getAttribute("additionalDraggerHostId");
            if (hostId) {
                const hostElement = document.getElementById(hostId);
                if (hostElement) {
                    hosts.push(hostElement);
                }
            }
        }

        for (const host of hosts) {
            host.addEventListener('contextmenu', event => event.preventDefault());
            host.addEventListener('mousedown', function(e) {
                if (e.button !== button) {
                    return;
                }

                startPreviewPan(e.pageX, e.pageY);
            });
        }

        document.body.addEventListener('mousemove', function(e) {
            if (isPreviewPanDisabled()) {
                setPreviewPanPressed(false);
                return;
            }

            if (previewPanPressed) {
                window.scroll(window.pageXOffset - e.pageX + previewPanStartX, window.pageYOffset - e.pageY + previewPanStartY);
            }
        });

        document.body.addEventListener('mouseup', function() {
            setPreviewPanPressed(false);
        });

        document.body.addEventListener('mouseenter', function(e) {
            if (previewPanPressed && (e.buttons & buttonMask) !== buttonMask) {
                setPreviewPanPressed(false);
            }
        });
    })();

    subscribeNavigators();

    enableDropdowns();
    enableCheckboxes();

    numDropDownOpened$.subscribe(num => {
        shouldDisableZoom = num > 0;
    });
});
