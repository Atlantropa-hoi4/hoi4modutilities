import * as vscode from 'vscode';

export const hoi4LocalisationColors = {
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
} as const;

export type Hoi4LocalisationColorCode = keyof typeof hoi4LocalisationColors;
type NonResetColorCode = Exclude<Hoi4LocalisationColorCode, '!'>;
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

const localisationHeaderPattern = /^\uFEFF?\s*l_[a-z_]+:/im;
const localisationEntryPattern = /^\uFEFF?\s*[^\s#][^:]*:\s*\d+\s*"/;
const colorCodePattern = /§([RGBYHWTCLObg0123456789t!])/g;
const textIconPattern = /£[A-Za-z0-9_.|:-]+£?/g;
const localisationReferencePattern = /\$[^$\r\n]+\$/g;
const scriptedLocalisationPattern = /\[[^\]\r\n]+\]/g;

export function isHoi4LocalisationText(text: string): boolean {
    return localisationHeaderPattern.test(text) || localisationEntryPattern.test(text);
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
        const prefixMatch = lineWithoutBreak.match(localisationEntryPattern);
        if (!prefixMatch) {
            continue;
        }

        const openingQuoteIndex = prefixMatch[0].length - 1;
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

export function collectLocalisationDecorations(text: string): LocalisationDecoration[] {
    const decorations: LocalisationDecoration[] = [];

    for (const range of findLocalisationStringRanges(text)) {
        const stringContent = text.slice(range.start, range.end);

        appendColorDecorations(decorations, stringContent, range.start);
        appendPatternDecorations(decorations, stringContent, range.start, textIconPattern, 'textIcon');
        appendPatternDecorations(decorations, stringContent, range.start, localisationReferencePattern, 'localisationReference');
        appendPatternDecorations(decorations, stringContent, range.start, scriptedLocalisationPattern, 'scriptedLocalisation');
    }

    return decorations;
}

export function registerLocalisationHighlighting(): vscode.Disposable {
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

    for (const [code, info] of Object.entries(hoi4LocalisationColors) as [Hoi4LocalisationColorCode, typeof hoi4LocalisationColors[Hoi4LocalisationColorCode]][]) {
        colorCodeTypes.set(code, vscode.window.createTextEditorDecorationType({
            color: info.color,
            fontWeight: code === '!' ? 'normal' : 'bold',
            fontStyle: code === '!' ? 'italic' : 'normal',
            backgroundColor: code === '!' ? undefined : `${info.color}22`,
            borderRadius: '2px',
        }));

        if (code !== '!') {
            colorTextTypes.set(code, vscode.window.createTextEditorDecorationType({
                color: info.color,
            }));
        }
    }

    let refreshHandle: NodeJS.Timeout | undefined;
    const scheduleRefresh = (document?: vscode.TextDocument) => {
        if (refreshHandle) {
            clearTimeout(refreshHandle);
        }

        refreshHandle = setTimeout(() => {
            refreshHandle = undefined;
            refreshVisibleEditors(document);
        }, 50);
        refreshHandle.unref?.();
    };

    const refreshVisibleEditors = (document?: vscode.TextDocument) => {
        for (const editor of vscode.window.visibleTextEditors) {
            if (document && editor.document !== document) {
                continue;
            }

            updateEditorDecorations(editor, colorCodeTypes, colorTextTypes, tokenTypes);
        }
    };

    scheduleRefresh();

    const disposables: vscode.Disposable[] = [
        vscode.window.onDidChangeActiveTextEditor(() => scheduleRefresh()),
        vscode.window.onDidChangeVisibleTextEditors(() => scheduleRefresh()),
        vscode.window.onDidChangeTextEditorVisibleRanges(e => scheduleRefresh(e.textEditor.document)),
        vscode.workspace.onDidOpenTextDocument(document => scheduleRefresh(document)),
        vscode.workspace.onDidChangeTextDocument(event => scheduleRefresh(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => scheduleRefresh(document)),
        ...colorCodeTypes.values(),
        ...colorTextTypes.values(),
        ...Object.values(tokenTypes),
        new vscode.Disposable(() => {
            if (refreshHandle) {
                clearTimeout(refreshHandle);
            }
        }),
    ];

    return vscode.Disposable.from(...disposables);
}

function appendColorDecorations(decorations: LocalisationDecoration[], stringContent: string, absoluteStart: number): void {
    let activeColor: Hoi4LocalisationColorCode | undefined;
    let currentTextStart = 0;

    for (const match of stringContent.matchAll(colorCodePattern)) {
        const codeStart = match.index ?? 0;
        const code = match[1] as Hoi4LocalisationColorCode;

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

function updateEditorDecorations(
    editor: vscode.TextEditor,
    colorCodeTypes: Map<Hoi4LocalisationColorCode, vscode.TextEditorDecorationType>,
    colorTextTypes: Map<NonResetColorCode, vscode.TextEditorDecorationType>,
    tokenTypes: Record<Exclude<LocalisationDecorationKind, 'colorCode' | 'colorText'>, vscode.TextEditorDecorationType>,
): void {
    const document = editor.document;
    if (!isHoi4LocalisationDocument(document)) {
        clearDecorations(editor, colorCodeTypes, colorTextTypes, tokenTypes);
        return;
    }

    const buckets = createDecorationBuckets();
    for (const decoration of collectLocalisationDecorations(document.getText())) {
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

    for (const [code, decorationType] of colorCodeTypes) {
        editor.setDecorations(decorationType, buckets.colorCode[code]);
    }

    for (const [code, decorationType] of colorTextTypes) {
        editor.setDecorations(decorationType, buckets.colorText[code]);
    }

    editor.setDecorations(tokenTypes.textIcon, buckets.textIcon);
    editor.setDecorations(tokenTypes.localisationReference, buckets.localisationReference);
    editor.setDecorations(tokenTypes.scriptedLocalisation, buckets.scriptedLocalisation);
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
    if (!path.toLowerCase().endsWith('.yml')) {
        return false;
    }

    return isHoi4LocalisationText(document.getText().slice(0, 4000));
}

function createDecorationBuckets() {
    const colorCode = {} as Record<Hoi4LocalisationColorCode, vscode.Range[]>;
    const colorText = {} as Record<NonResetColorCode, vscode.Range[]>;

    for (const code of Object.keys(hoi4LocalisationColors) as Hoi4LocalisationColorCode[]) {
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
