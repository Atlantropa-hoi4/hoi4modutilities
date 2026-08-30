import * as vscode from 'vscode';
import { Logger } from './logger';
import { sendException } from './telemetry';
import { listFilesFromModOrHOI4, readFileFromModOrHOI4, getSelectedModRootFolders } from './fileloader';
import { parseHoi4File, Node } from '../hoiformat/hoiparser';
import { onDidChangeSelectedModSource } from './modfile';

export interface Hoi4LocalisationColorInfo {
    color: string;
    name: string;
}

export type Hoi4LocalisationColorPalette = Record<string, Hoi4LocalisationColorInfo>;

export const hoi4LocalisationColors: Hoi4LocalisationColorPalette = {
    R: { color: '#FF3232', name: 'Red' },
    G: { color: '#009F03', name: 'Green' },
    B: { color: '#0000FF', name: 'Blue' },
    Y: { color: '#FFBD00', name: 'Yellow' },
    H: { color: '#FFBD00', name: 'Header' },
    W: { color: '#FFFFFF', name: 'White' },
    T: { color: '#FFFFFF', name: 'Title' },
    C: { color: '#23CEFF', name: 'Cyan' },
    L: { color: '#C3B091', name: 'Lilac' },
    O: { color: '#FF7019', name: 'Orange' },
    b: { color: '#808080', name: 'Black' },
    g: { color: '#B0B0B0', name: 'Gray' },
    0: { color: '#CB00CB', name: 'Gradient 0' },
    1: { color: '#8078D3', name: 'Gradient 1' },
    2: { color: '#5170F3', name: 'Gradient 2' },
    3: { color: '#518FDC', name: 'Gradient 3' },
    4: { color: '#5ABEE7', name: 'Gradient 4' },
    5: { color: '#3FB5C2', name: 'Gradient 5' },
    6: { color: '#77CCBA', name: 'Gradient 6' },
    7: { color: '#99D199', name: 'Gradient 7' },
    8: { color: '#CCA333', name: 'Gradient 8' },
    9: { color: '#FCA97D', name: 'Gradient 9' },
    t: { color: '#FF4C4D', name: 'Gradient t' },
    '!': { color: '#888888', name: 'Reset' },
};

export type Hoi4LocalisationColorCode = string;
type NonResetColorCode = string;
export type LocalisationThemeTone = 'dark' | 'light';
export type LocalisationDecorationKind = 'colorCode' | 'colorText' | 'textIcon' | 'localisationReference' | 'scriptedLocalisation';

export interface LocalisationStringRange {
    start: number;
    end: number;
}

export interface LocalisationDecoration {
    kind: LocalisationDecorationKind;
    start: number;
    end: number;
    colorCode?: Hoi4LocalisationColorCode;
}

interface LocalisationRangeBuckets {
    colorCode: Record<Hoi4LocalisationColorCode, vscode.Range[]>;
    colorText: Record<NonResetColorCode, vscode.Range[]>;
    textIcon: vscode.Range[];
    localisationReference: vscode.Range[];
    scriptedLocalisation: vscode.Range[];
}

interface LocalisationDocumentAnalysis {
    key: string;
    version: number;
    isHoi4Localisation: boolean;
    hasDecorations: boolean;
    buckets?: LocalisationRangeBuckets;
}

interface AppliedDecorationState {
    documentKey: string;
    version: number;
    generation: number;
    hasDecorations: boolean;
}

const localisationHeaderPattern = /^\uFEFF?\s*l_[a-z_]+:/im;
const localisationEntryPattern = /^\uFEFF?\s*[^\s#][^:]*:\s*\d+\s*"/;
const localisationValuePattern = /^\uFEFF?\s*[^\s#][^:]*:\s*(?:\d+\s*)?"/;
const colorCodePattern = /§([A-Za-z0-9!])/g;
const textIconPattern = /£[A-Za-z0-9_.|:-]+£?/g;
const localisationReferencePattern = /\$[^$\r\n]+\$/g;
const scriptedLocalisationPattern = /\[[^\]\r\n]+\]/g;
const hoi4LocalisationExtensionPattern = /\.ya?ml$/i;
const hoi4LocalisationPathPattern = /(^|[\\/])(locali[sz]ation)([\\/]|$)/i;
const hoi4LocalisationFilePattern = /(?:^|[ _-])l_[a-z_]+\.ya?ml$/i;
const hoi4LocalisationTokenHintPattern = /§[A-Za-z0-9!]|£[A-Za-z0-9_.|:-]+£?|\$[^$\r\n]+\$|\[[^\]\r\n]+\]/;

export function isHoi4LocalisationText(text: string): boolean {
    return localisationHeaderPattern.test(text) || localisationEntryPattern.test(text);
}

export function isLikelyHoi4LocalisationPath(path: string): boolean {
    if (!hoi4LocalisationExtensionPattern.test(path)) {
        return false;
    }

    return hoi4LocalisationPathPattern.test(path) || hoi4LocalisationFilePattern.test(path);
}

export function hasHoi4LocalisationTokenHints(text: string): boolean {
    return hoi4LocalisationTokenHintPattern.test(text);
}

function documentHasHoi4LocalisationTokenHints(document: vscode.TextDocument): boolean {
    for (let i = 0; i < document.lineCount; i++) {
        if (hasHoi4LocalisationTokenHints(document.lineAt(i).text)) {
            return true;
        }
    }

    return false;
}

export function findLocalisationStringRanges(text: string): LocalisationStringRange[] {
    const ranges: LocalisationStringRange[] = [];
    const linePattern = /.*(?:\r\n|\r|\n|$)/g;

    for (const lineMatch of text.matchAll(linePattern)) {
        const fullLine = lineMatch[0];
        if (!fullLine) {
            continue;
        }

        const lineStart = lineMatch.index ?? 0;
        const lineWithoutBreak = fullLine.replace(/[\r\n]+$/, '');
        if (!isRelevantLocalisationLine(lineWithoutBreak)) {
            continue;
        }

        const openingQuoteIndex = lineWithoutBreak.indexOf('"');
        if (openingQuoteIndex === -1) {
            continue;
        }

        let closingQuoteIndex = -1;
        for (let i = openingQuoteIndex + 1; i < lineWithoutBreak.length; i++) {
            const ch = lineWithoutBreak[i];
            if (ch === '\\') {
                i++;
                continue;
            }

            if (ch === '"') {
                closingQuoteIndex = i;
                break;
            }
        }

        if (closingQuoteIndex === -1 || closingQuoteIndex < openingQuoteIndex + 1) {
            continue;
        }

        ranges.push({
            start: lineStart + openingQuoteIndex + 1,
            end: lineStart + closingQuoteIndex,
        });
    }

    return ranges;
}

export function collectLocalisationDecorations(
    text: string,
    colors: Hoi4LocalisationColorPalette = hoi4LocalisationColors,
): LocalisationDecoration[] {
    const decorations: LocalisationDecoration[] = [];

    for (const range of findLocalisationStringRanges(text)) {
        const stringContent = text.slice(range.start, range.end);

        appendColorDecorations(decorations, stringContent, range.start, colors);
        appendPatternDecorations(decorations, stringContent, range.start, textIconPattern, 'textIcon');
        appendPatternDecorations(decorations, stringContent, range.start, localisationReferencePattern, 'localisationReference');
        appendPatternDecorations(decorations, stringContent, range.start, scriptedLocalisationPattern, 'scriptedLocalisation');
    }

    return decorations;
}

export function registerLocalisationHighlighting(): vscode.Disposable {
    let colors = cloneLocalisationColorPalette(hoi4LocalisationColors);
    let decorationSet = createDecorationSet(getThemeTone(vscode.window.activeColorTheme.kind), colors);
    let decorationGeneration = 0;
    let colorLoadGeneration = 0;
    let sourceWatcherGeneration = 0;
    let sourceWatchers: vscode.Disposable[] = [];
    const documentAnalysisCache = new Map<string, LocalisationDocumentAnalysis>();
    const appliedEditorState = new WeakMap<vscode.TextEditor, AppliedDecorationState>();

    let refreshHandle: NodeJS.Timeout | undefined;
    let refreshAllVisibleEditors = false;
    const pendingDocumentKeys = new Set<string>();

    const scheduleRefresh = (document?: vscode.TextDocument) => {
        if (document) {
            pendingDocumentKeys.add(getDocumentCacheKey(document));
        } else {
            refreshAllVisibleEditors = true;
        }

        if (refreshHandle) {
            clearTimeout(refreshHandle);
        }

        refreshHandle = setTimeout(() => {
            refreshHandle = undefined;
            refreshVisibleEditors();
        }, 50);
        refreshHandle.unref?.();
    };

    const refreshVisibleEditors = () => {
        const editors = refreshAllVisibleEditors
            ? vscode.window.visibleTextEditors
            : vscode.window.visibleTextEditors.filter(editor => pendingDocumentKeys.has(getDocumentCacheKey(editor.document)));

        refreshAllVisibleEditors = false;
        pendingDocumentKeys.clear();

        for (const editor of editors) {

            try {
                updateEditorDecorations(
                    editor,
                    decorationSet.colorCodeTypes,
                    decorationSet.colorTextTypes,
                    decorationSet.tokenTypes,
                    documentAnalysisCache,
                    appliedEditorState,
                    decorationGeneration,
                    colors,
                );
            } catch (error) {
                reportLocalisationHighlightingError(error, editor.document);
            }
        }
    };

    const rebuildDecorationTypes = () => {
        decorationSet.dispose();
        decorationSet = createDecorationSet(getThemeTone(vscode.window.activeColorTheme.kind), colors);
        decorationGeneration++;
        documentAnalysisCache.clear();
        scheduleRefresh();
    };

    const reloadColors = async () => {
        const generation = ++colorLoadGeneration;
        try {
            const loadedColors = await loadLocalisationColorPalette();
            if (generation === colorLoadGeneration && !areLocalisationColorPalettesEqual(colors, loadedColors)) {
                colors = loadedColors;
                rebuildDecorationTypes();
            }
        } catch (error) {
            reportLocalisationColorLoadingError(error);
        }
    };

    const rebuildSourceWatchers = async () => {
        const generation = ++sourceWatcherGeneration;
        sourceWatchers.forEach(watcher => watcher.dispose());
        sourceWatchers = [];
        const roots = await getSelectedModRootFolders();
        const watchers = roots.map(root => createLocalisationColorWatcher(
            new vscode.RelativePattern(root, 'interface/**/*.gfx'),
            () => void reloadColors(),
        ));
        if (generation !== sourceWatcherGeneration) {
            vscode.Disposable.from(...watchers).dispose();
            return;
        }
        sourceWatchers = watchers;
    };

    scheduleRefresh();
    void reloadColors();
    void rebuildSourceWatchers();

    const workspaceColorWatcher = createLocalisationColorWatcher(
        '**/interface/**/*.gfx',
        () => void reloadColors(),
    );

    const disposables: vscode.Disposable[] = [
        vscode.window.onDidChangeActiveColorTheme(() => rebuildDecorationTypes()),
        vscode.window.onDidChangeActiveTextEditor(editor => scheduleRefresh(editor?.document)),
        vscode.window.onDidChangeVisibleTextEditors(() => scheduleRefresh()),
        vscode.workspace.onDidOpenTextDocument(document => {
            documentAnalysisCache.delete(getDocumentCacheKey(document));
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            documentAnalysisCache.delete(getDocumentCacheKey(event.document));
            scheduleRefresh(event.document);
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            documentAnalysisCache.delete(getDocumentCacheKey(document));
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void reloadColors();
            void rebuildSourceWatchers();
        }),
        onDidChangeSelectedModSource(() => {
            void reloadColors();
            void rebuildSourceWatchers();
        }),
        workspaceColorWatcher,
        new vscode.Disposable(() => {
            colorLoadGeneration++;
            sourceWatcherGeneration++;
            sourceWatchers.forEach(watcher => watcher.dispose());
            if (refreshHandle) {
                clearTimeout(refreshHandle);
            }
            documentAnalysisCache.clear();
            decorationSet.dispose();
        }),
    ];

    return vscode.Disposable.from(...disposables);
}

function appendColorDecorations(
    decorations: LocalisationDecoration[],
    stringContent: string,
    absoluteStart: number,
    colors: Hoi4LocalisationColorPalette,
): void {
    let activeColor: Hoi4LocalisationColorCode | undefined;
    let currentTextStart = 0;

    for (const match of stringContent.matchAll(colorCodePattern)) {
        const codeStart = match.index ?? 0;
        const code = match[1] as Hoi4LocalisationColorCode;
        if (code !== '!' && !colors[code]) {
            continue;
        }

        if (activeColor && codeStart > currentTextStart) {
            decorations.push({
                kind: 'colorText',
                start: absoluteStart + currentTextStart,
                end: absoluteStart + codeStart,
                colorCode: activeColor,
            });
        }

        decorations.push({
            kind: 'colorCode',
            start: absoluteStart + codeStart,
            end: absoluteStart + codeStart + match[0].length,
            colorCode: code,
        });

        activeColor = code === '!' ? undefined : code;
        currentTextStart = codeStart + match[0].length;
    }

    if (activeColor && currentTextStart < stringContent.length) {
        decorations.push({
            kind: 'colorText',
            start: absoluteStart + currentTextStart,
            end: absoluteStart + stringContent.length,
            colorCode: activeColor,
        });
    }
}

function appendPatternDecorations(
    decorations: LocalisationDecoration[],
    stringContent: string,
    absoluteStart: number,
    pattern: RegExp,
    kind: Exclude<LocalisationDecorationKind, 'colorCode' | 'colorText'>,
): void {
    for (const match of stringContent.matchAll(pattern)) {
        const start = match.index ?? 0;
        decorations.push({
            kind,
            start: absoluteStart + start,
            end: absoluteStart + start + match[0].length,
        });
    }
}

function createDecorationSet(themeTone: LocalisationThemeTone, colors: Hoi4LocalisationColorPalette) {
    const colorCodeTypes = new Map<Hoi4LocalisationColorCode, vscode.TextEditorDecorationType>();
    const colorTextTypes = new Map<NonResetColorCode, vscode.TextEditorDecorationType>();
    const tokenTypes = {
        textIcon: vscode.window.createTextEditorDecorationType({
            color: '#4FD7FF',
            fontWeight: 'bold',
            backgroundColor: '#4FD7FF22',
            borderRadius: '2px',
        }),
        localisationReference: vscode.window.createTextEditorDecorationType({
            color: '#F4D35E',
            fontWeight: 'bold',
            backgroundColor: '#F4D35E22',
            borderRadius: '2px',
        }),
        scriptedLocalisation: vscode.window.createTextEditorDecorationType({
            color: '#7AA6FF',
            fontStyle: 'italic',
            backgroundColor: '#7AA6FF22',
            borderRadius: '2px',
        }),
    } satisfies Record<Exclude<LocalisationDecorationKind, 'colorCode' | 'colorText'>, vscode.TextEditorDecorationType>;

    for (const [code, info] of Object.entries(colors)) {
        colorCodeTypes.set(code, vscode.window.createTextEditorDecorationType({
            color: info.color,
            fontWeight: code === '!' ? 'normal' : 'bold',
            fontStyle: code === '!' ? 'italic' : 'normal',
            backgroundColor: code === '!' ? undefined : `${info.color}22`,
            borderRadius: '2px',
        }));

        if (code !== '!') {
            const correctedColor = correctLocalisationTextColor(info.color, themeTone);
            colorTextTypes.set(code, vscode.window.createTextEditorDecorationType({
                color: correctedColor,
                fontWeight: '600',
                backgroundColor: `${correctedColor}${themeTone === 'dark' ? '20' : '18'}`,
                borderRadius: '2px',
            }));
        }
    }

    return {
        colorCodeTypes,
        colorTextTypes,
        tokenTypes,
        dispose: () => {
            for (const decorationType of colorCodeTypes.values()) {
                decorationType.dispose();
            }
            for (const decorationType of colorTextTypes.values()) {
                decorationType.dispose();
            }
            for (const decorationType of Object.values(tokenTypes)) {
                decorationType.dispose();
            }
        },
    };
}

function getThemeTone(kind: vscode.ColorThemeKind): LocalisationThemeTone {
    return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? 'light' : 'dark';
}

export function correctLocalisationTextColor(hexColor: string, themeTone: LocalisationThemeTone): string {
    const rgb = parseHexColor(hexColor);
    if (!rgb) {
        return hexColor;
    }

    const luminance = getRelativeLuminance(rgb);
    let adjusted = rgb;

    if (themeTone === 'dark') {
        if (luminance < 0.42) {
            adjusted = blendColors(rgb, { r: 255, g: 255, b: 255 }, Math.min(0.58, 0.20 + (0.42 - luminance) * 1.35));
        } else if (luminance > 0.88) {
            adjusted = blendColors(rgb, { r: 0, g: 0, b: 0 }, Math.min(0.28, 0.08 + (luminance - 0.88) * 1.2));
        }
    } else {
        if (luminance > 0.72) {
            adjusted = blendColors(rgb, { r: 0, g: 0, b: 0 }, Math.min(0.65, 0.22 + (luminance - 0.72) * 1.6));
        } else if (luminance < 0.20) {
            adjusted = blendColors(rgb, { r: 255, g: 255, b: 255 }, Math.min(0.48, 0.12 + (0.20 - luminance) * 1.25));
        }
    }

    return toHexColor(adjusted);
}

function isRelevantLocalisationLine(line: string): boolean {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) {
        return false;
    }

    if (localisationHeaderPattern.test(trimmed)) {
        return false;
    }

    return localisationValuePattern.test(trimmed);
}

function parseHexColor(hexColor: string): { r: number; g: number; b: number } | undefined {
    const match = /^#?([0-9a-f]{6})$/i.exec(hexColor);
    if (!match) {
        return undefined;
    }

    const value = match[1];
    return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16),
    };
}

function blendColors(
    source: { r: number; g: number; b: number },
    target: { r: number; g: number; b: number },
    amount: number,
): { r: number; g: number; b: number } {
    const ratio = Math.max(0, Math.min(1, amount));
    return {
        r: Math.round(source.r + (target.r - source.r) * ratio),
        g: Math.round(source.g + (target.g - source.g) * ratio),
        b: Math.round(source.b + (target.b - source.b) * ratio),
    };
}

function getRelativeLuminance(rgb: { r: number; g: number; b: number }): number {
    const normalize = (channel: number) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * normalize(rgb.r) + 0.7152 * normalize(rgb.g) + 0.0722 * normalize(rgb.b);
}

function toHexColor(rgb: { r: number; g: number; b: number }): string {
    return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`.toUpperCase();
}

function updateEditorDecorations(
    editor: vscode.TextEditor,
    colorCodeTypes: Map<Hoi4LocalisationColorCode, vscode.TextEditorDecorationType>,
    colorTextTypes: Map<NonResetColorCode, vscode.TextEditorDecorationType>,
    tokenTypes: Record<Exclude<LocalisationDecorationKind, 'colorCode' | 'colorText'>, vscode.TextEditorDecorationType>,
    documentAnalysisCache: Map<string, LocalisationDocumentAnalysis>,
    appliedEditorState: WeakMap<vscode.TextEditor, AppliedDecorationState>,
    decorationGeneration: number,
    colors: Hoi4LocalisationColorPalette,
): void {
    const document = editor.document;
    const analysis = getDocumentAnalysis(document, documentAnalysisCache, colors);
    const appliedState = appliedEditorState.get(editor);

    if (appliedState &&
        appliedState.documentKey === analysis.key &&
        appliedState.version === analysis.version &&
        appliedState.generation === decorationGeneration) {
        return;
    }

    if (!analysis.isHoi4Localisation || !analysis.hasDecorations || !analysis.buckets) {
        if (appliedState?.hasDecorations) {
            clearDecorations(editor, colorCodeTypes, colorTextTypes, tokenTypes);
        }
        appliedEditorState.set(editor, {
            documentKey: analysis.key,
            version: analysis.version,
            generation: decorationGeneration,
            hasDecorations: false,
        });
        return;
    }

    for (const [code, decorationType] of colorCodeTypes) {
        editor.setDecorations(decorationType, analysis.buckets.colorCode[code]);
    }

    for (const [code, decorationType] of colorTextTypes) {
        editor.setDecorations(decorationType, analysis.buckets.colorText[code]);
    }

    editor.setDecorations(tokenTypes.textIcon, analysis.buckets.textIcon);
    editor.setDecorations(tokenTypes.localisationReference, analysis.buckets.localisationReference);
    editor.setDecorations(tokenTypes.scriptedLocalisation, analysis.buckets.scriptedLocalisation);

    appliedEditorState.set(editor, {
        documentKey: analysis.key,
        version: analysis.version,
        generation: decorationGeneration,
        hasDecorations: true,
    });
}

function clearDecorations(
    editor: vscode.TextEditor,
    colorCodeTypes: Map<Hoi4LocalisationColorCode, vscode.TextEditorDecorationType>,
    colorTextTypes: Map<NonResetColorCode, vscode.TextEditorDecorationType>,
    tokenTypes: Record<Exclude<LocalisationDecorationKind, 'colorCode' | 'colorText'>, vscode.TextEditorDecorationType>,
): void {
    for (const decorationType of colorCodeTypes.values()) {
        editor.setDecorations(decorationType, []);
    }

    for (const decorationType of colorTextTypes.values()) {
        editor.setDecorations(decorationType, []);
    }

    for (const decorationType of Object.values(tokenTypes)) {
        editor.setDecorations(decorationType, []);
    }
}

function isHoi4LocalisationDocument(document: vscode.TextDocument): boolean {
    const path = document.uri.fsPath || document.uri.path;
    if (!hoi4LocalisationExtensionPattern.test(path)) {
        return false;
    }

    if (isLikelyHoi4LocalisationPath(path)) {
        return true;
    }

    const previewText = getDocumentPreviewText(document, 64000);
    return isHoi4LocalisationText(previewText) || hasHoi4LocalisationTokenHints(previewText);
}

function createDecorationBuckets(colors: Hoi4LocalisationColorPalette) {
    const colorCode = {} as Record<Hoi4LocalisationColorCode, vscode.Range[]>;
    const colorText = {} as Record<NonResetColorCode, vscode.Range[]>;

    for (const code of Object.keys(colors)) {
        colorCode[code] = [];
        if (code !== '!') {
            colorText[code] = [];
        }
    }

    return {
        colorCode,
        colorText,
        textIcon: [] as vscode.Range[],
        localisationReference: [] as vscode.Range[],
        scriptedLocalisation: [] as vscode.Range[],
    };
}

function getDocumentAnalysis(
    document: vscode.TextDocument,
    documentAnalysisCache: Map<string, LocalisationDocumentAnalysis>,
    colors: Hoi4LocalisationColorPalette,
): LocalisationDocumentAnalysis {
    const key = getDocumentCacheKey(document);
    const cached = documentAnalysisCache.get(key);
    if (cached && cached.version === document.version) {
        return cached;
    }

    if (!isHoi4LocalisationDocument(document)) {
        const analysis: LocalisationDocumentAnalysis = {
            key,
            version: document.version,
            isHoi4Localisation: false,
            hasDecorations: false,
        };
        documentAnalysisCache.set(key, analysis);
        return analysis;
    }

    if (!documentHasHoi4LocalisationTokenHints(document)) {
        const analysis: LocalisationDocumentAnalysis = {
            key,
            version: document.version,
            isHoi4Localisation: true,
            hasDecorations: false,
        };
        documentAnalysisCache.set(key, analysis);
        return analysis;
    }

    const text = document.getText();
    const decorations = collectLocalisationDecorations(text, colors);
    const analysis: LocalisationDocumentAnalysis = {
        key,
        version: document.version,
        isHoi4Localisation: true,
        hasDecorations: decorations.length > 0,
        buckets: decorations.length > 0 ? createRangeBuckets(document, decorations, colors) : undefined,
    };
    documentAnalysisCache.set(key, analysis);
    return analysis;
}

function getDocumentCacheKey(document: vscode.TextDocument): string {
    return document.uri.toString(true);
}

function getDocumentPreviewText(document: vscode.TextDocument, maxChars: number): string {
    let remaining = maxChars;
    let preview = '';
    const maxLineCount = Math.min(document.lineCount, 256);

    for (let i = 0; i < maxLineCount && remaining > 0; i++) {
        const fragment = document.lineAt(i).text.slice(0, remaining);
        preview += fragment;
        remaining -= fragment.length;
        if (remaining > 0 && i < maxLineCount - 1) {
            preview += '\n';
            remaining--;
        }
    }

    return preview;
}

function createRangeBuckets(
    document: vscode.TextDocument,
    decorations: LocalisationDecoration[],
    colors: Hoi4LocalisationColorPalette,
): LocalisationRangeBuckets {
    const buckets = createDecorationBuckets(colors);
    for (const decoration of decorations) {
        const range = new vscode.Range(document.positionAt(decoration.start), document.positionAt(decoration.end));

        switch (decoration.kind) {
        case 'colorCode':
            if (decoration.colorCode) {
                buckets.colorCode[decoration.colorCode].push(range);
            }
            break;
        case 'colorText':
            if (decoration.colorCode && decoration.colorCode !== '!') {
                buckets.colorText[decoration.colorCode].push(range);
            }
            break;
        case 'textIcon':
            buckets.textIcon.push(range);
            break;
        case 'localisationReference':
            buckets.localisationReference.push(range);
            break;
        case 'scriptedLocalisation':
            buckets.scriptedLocalisation.push(range);
            break;
        }
    }

    return buckets;
}

function reportLocalisationHighlightingError(error: unknown, document: vscode.TextDocument): void {
    const exception = error instanceof Error ? error : new Error(String(error));
    const path = document.uri.toString(true);
    Logger.error(`Localisation highlighting failed for ${path}: ${exception.stack ?? exception.message}`);
    sendException(exception, {
        feature: 'localisationHighlighting',
        document: path,
    });
}

export function extractHoi4LocalisationColors(text: string): Hoi4LocalisationColorPalette {
    const result: Hoi4LocalisationColorPalette = {};
    if (!/\btextcolors\s*=/i.test(text)) {
        return result;
    }
    const root = parseHoi4File(text);
    visitHoi4Nodes(root, node => {
        if (node.name?.toLowerCase() !== 'textcolors' || !Array.isArray(node.value)) {
            return;
        }

        for (const colorNode of node.value) {
            const code = colorNode.name;
            if (!code || !/^[A-Za-z0-9]$/.test(code) || !Array.isArray(colorNode.value)) {
                continue;
            }

            const channels = colorNode.value
                .map(channel => Number(channel.name))
                .filter(channel => Number.isFinite(channel));
            if (channels.length < 3) {
                continue;
            }

            result[code] = {
                color: toHexColor({
                    r: clampColorChannel(channels[0]),
                    g: clampColorChannel(channels[1]),
                    b: clampColorChannel(channels[2]),
                }),
                name: `Custom ${code}`,
            };
        }
    });
    return result;
}

export function mergeLocalisationColorPalettes(
    contentsFromLowToHighPriority: readonly string[],
): Hoi4LocalisationColorPalette {
    const result = cloneLocalisationColorPalette(hoi4LocalisationColors);
    for (const content of contentsFromLowToHighPriority) {
        try {
            for (const [code, info] of Object.entries(extractHoi4LocalisationColors(content))) {
                result[code] = {
                    ...info,
                    name: result[code]?.name ?? info.name,
                };
            }
        } catch {
            // A malformed unrelated GFX file must not hide colors from the remaining content layers.
        }
    }
    return result;
}

async function loadLocalisationColorPalette(): Promise<Hoi4LocalisationColorPalette> {
    const gfxFiles = (await listFilesFromModOrHOI4('interface', {
        recursively: true,
        hoi4: false,
        dlc: false,
    })).filter(file => file.toLowerCase().endsWith('.gfx'));
    const contents = await Promise.all(gfxFiles.map(async file => {
        try {
            return (await readFileFromModOrHOI4(`interface/${file}`, { hoi4: false, dlc: false }))[0].toString();
        } catch {
            return '';
        }
    }));
    return mergeLocalisationColorPalettes(contents.reverse());
}

function createLocalisationColorWatcher(
    pattern: vscode.GlobPattern,
    onChange: () => void,
): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    return vscode.Disposable.from(
        watcher,
        watcher.onDidChange(onChange),
        watcher.onDidCreate(onChange),
        watcher.onDidDelete(onChange),
    );
}

function visitHoi4Nodes(node: Node, callback: (node: Node) => void): void {
    if (!Array.isArray(node.value)) {
        return;
    }
    for (const child of node.value) {
        callback(child);
        visitHoi4Nodes(child, callback);
    }
}

function clampColorChannel(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function cloneLocalisationColorPalette(colors: Hoi4LocalisationColorPalette): Hoi4LocalisationColorPalette {
    return Object.fromEntries(Object.entries(colors).map(([code, info]) => [code, { ...info }]));
}

function areLocalisationColorPalettesEqual(
    left: Hoi4LocalisationColorPalette,
    right: Hoi4LocalisationColorPalette,
): boolean {
    const leftEntries = Object.entries(left);
    const rightEntries = Object.entries(right);
    return leftEntries.length === rightEntries.length
        && leftEntries.every(([code, info]) => right[code]?.color === info.color && right[code]?.name === info.name);
}

function reportLocalisationColorLoadingError(error: unknown): void {
    const exception = error instanceof Error ? error : new Error(String(error));
    Logger.error(`Localisation color loading failed: ${exception.stack ?? exception.message}`);
    sendException(exception, { feature: 'localisationHighlightingColors' });
}
