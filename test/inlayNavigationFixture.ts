import Module = require('module');
import type { FocusTree, FocusTreeInlay } from '../src/previewdef/focustree/schema';
import type { Token, Node } from '../src/hoiformat/hoiparser';

export async function withInlayNavigationFixture<T>(run: (fixture: Awaited<ReturnType<typeof buildFixture>>) => Promise<T>): Promise<T> {
    const loader = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, main: boolean) => unknown };
    const originalLoad = loader._load;
    const cached = { ...require.cache };
    for (const key of Object.keys(require.cache)) {
        if (/[\\/](?:out[\\/])?src[\\/]/.test(key)) { delete require.cache[key]; }
    }
    const documents = new Map<string, { file: string; version: number; getText(): string; positionAt(offset: number): { offset: number } }>();
    const opened: Array<{ file: string; start: number; end: number }> = [];
    const uri = (file: string) => ({ file, path: file, toString: () => file });
    class Emitter { public event = () => ({ dispose: () => undefined }); public fire(): void { } public dispose(): void { } }
    loader._load = function(request, parent, main) {
        const name = request.split(/[\\/]/).pop();
        if (request === 'vscode') {
            return { EventEmitter: Emitter, Range: class { constructor(public start: { offset: number }, public end: { offset: number }) { } },
                ViewColumn: { One: 1 }, env: { language: 'en' },
                window: { showTextDocument: async (document: { file: string }, options: { selection: { start: { offset: number }; end: { offset: number } } }) => {
                    opened.push({ file: document.file, start: options.selection.start.offset, end: options.selection.end.offset });
                } }, workspace: { openTextDocument: async (path: { file: string }) => documents.get(path.file),
                    getConfiguration: () => ({ featureFlags: [], previewLocalisation: 'English' }) } };
        }
        if (name === 'loader' && /[\\/]focustree[\\/]contentbuilder\.(?:js|ts)$/.test(parent?.filename ?? '')) {
            return { FocusTreeLoader: class { } };
        }
        if (name === 'imagecache') {
            const { Sprite } = originalLoad.call(this, '../src/util/image/sprite', module, false) as typeof import('../src/util/image/sprite');
            const sprite = new Sprite('test', { width: 48, height: 48, uri: 'data:image/svg+xml,%3Csvg/%3E' } as any, 1);
            return { Image: class { }, getSpriteByGfxName: async () => sprite, getSpriteByGfxNameFromResolvedFiles: async () => sprite };
        }
        if (name === 'localisationIndex') { return { getLocalisedTextQuick: async (key: string) => key,
            getLocalisedTextQuickIfReady: (key: string) => key, isLocalisationIndexReady: () => false }; }
        if (name === 'featureflags') { return { isLocalisationIndexEnabled: () => false, isUseConditionInFocusEnabled: () => false }; }
        if (name === 'i18n') { return { localize: (_key: string, text: string) => text }; }
        if (name === 'vsccommon') { return { getDocumentByUri: (path: { file: string }) => documents.get(path.file) }; }
        if (name === 'fileloader') { return { getFilePathFromMod: async (file: string) => uri(file),
            getHoiOpenedFileOriginalUri: (path: unknown) => path }; }
        return originalLoad.call(this, request, parent, main);
    };
    try { return await run(await buildFixture(documents, opened)); }
    finally {
        loader._load = originalLoad;
        for (const key of Object.keys(require.cache)) { if (!cached[key]) { delete require.cache[key]; } }
        Object.assign(require.cache, cached);
    }
}

async function buildFixture(
    documents: Map<string, { file: string; version: number; getText(): string; positionAt(offset: number): { offset: number } }>,
    opened: Array<{ file: string; start: number; end: number }>,
) {
    const { renderInlayWindow } = require('../src/previewdef/focustree/contentbuilder') as typeof import('../src/previewdef/focustree/contentbuilder');
    const { StyleTable } = require('../src/util/styletable') as typeof import('../src/util/styletable');
    const { parseHoi4File } = require('../src/hoiformat/hoiparser') as typeof import('../src/hoiformat/hoiparser');
    const { guiFileSchema } = require('../src/hoiformat/gui') as typeof import('../src/hoiformat/gui');
    const { convertNodeToJson } = require('../src/hoiformat/schema') as typeof import('../src/hoiformat/schema');
    const { toFocusTreeViews } = require('../src/previewdef/focustree/viewmodel') as typeof import('../src/previewdef/focustree/viewmodel');
    const { createFocusTreeRenderCache } = require('../src/previewdef/focustree/renderpayloadpatch') as typeof import('../src/previewdef/focustree/renderpayloadpatch');
    const { PreviewBase } = require('../src/previewdef/previewbase') as typeof import('../src/previewdef/previewbase');
    const files = { focus: 'common/national_focus/a&"quoted.txt', second: 'common/national_focus/second.txt',
        definition: 'common/focus_inlay_windows/a&"definition.txt', gui: 'interface/inlay.gui' };
    const focusText = '# Focus source\nfocus_tree = { id = first inlay_window = { id = inlay position = { x = 0 y = 0 } } }';
    const secondText = '# Another tree\n\nfocus_tree = { id = second inlay_window = { id = inlay position = { x = 5 y = 0 } } }';
    const definitionText = '# Inlay definition\ninlay = { scripted_images = { image_slot = { GFX_TEST = yes } image_button = { GFX_TEST = yes } } scripted_buttons = { button_slot = { } } }';
    const children = (node: Node): Node[] => Array.isArray(node.value) ? node.value : [];
    const reference = (text: string) => children(children(parseHoi4File(text))[0]).find(node => node.name === 'inlay_window')!.nameToken!;
    const definition = children(parseHoi4File(definitionText))[0];
    const imageNodes = children(children(definition).find(node => node.name === 'scripted_images')!);
    const button = children(children(definition).find(node => node.name === 'scripted_buttons')!)[0];
    const gui = convertNodeToJson<import('../src/hoiformat/gui').GuiFile>(parseHoi4File(`
        guiTypes = { containerWindowType = { name = inlay_window size = { width = 500 height = 300 }
            containerWindowType = { name = nested size = { width = 400 height = 200 }
                iconType = { name = ordinary spriteType = GFX_TEST position = { x = 5 y = 5 } }
                iconType = { name = image_slot spriteType = GFX_TEST position = { x = 60 y = 5 } }
                buttonType = { name = image_button spriteType = GFX_TEST position = { x = 120 y = 5 } }
                buttonType = { name = button_slot spriteType = GFX_TEST buttonText = Test position = { x = 180 y = 5 } }
            }
        } }
    `), guiFileSchema).guitypes[0].containerwindowtype[0];
    const inlay: FocusTreeInlay = { id: 'inlay', file: files.definition, token: definition.nameToken!,
        referenceFile: files.focus, referenceToken: reference(focusText), guiFile: files.gui, guiWindow: gui,
        internal: false, visible: true, position: { x: 0, y: 0 }, conditionExprs: [],
        scriptedImages: imageNodes.map(node => ({ id: node.name!, file: files.definition, token: node.nameToken!,
            gfxOptions: [{ gfxName: 'GFX_TEST', file: files.definition, token: children(node)[0].nameToken!, condition: true }] })),
        scriptedButtons: [{ id: button.name!, file: files.definition, token: button.nameToken! }] };
    const tree = (id: string, value: FocusTreeInlay): FocusTree => ({ id, kind: 'focus', focuses: {}, inlayWindowRefs: [], inlayWindows: [value],
        inlayConditionExprs: [], allowBranchOptions: [], conditionExprs: [], isSharedFocues: false, warnings: [], searchFilters: [] });
    const secondInlay = { ...inlay, referenceFile: files.second, referenceToken: reference(secondText) };
    const views = toFocusTreeViews([tree('first', inlay), tree('second', secondInlay)]);
    for (const [file, text] of [[files.focus, focusText], [files.second, secondText], [files.definition, definitionText]]) {
        documents.set(file, { file, version: 1, getText: () => text, positionAt: offset => ({ offset }) });
    }
    class TestPreview extends PreviewBase { protected async getContent(): Promise<string> { return ''; } }
    const preview = new TestPreview({ file: files.focus, toString: () => files.focus } as any,
        { webview: { onDidReceiveMessage: () => undefined }, onDidDispose: () => undefined } as any);
    const html = await renderInlayWindow(inlay, new StyleTable(), []);
    const signature = (value: FocusTreeInlay) => {
        const sourceTrees = [tree('first', value)];
        return createFocusTreeRenderCache({ focusTrees: toFocusTreeViews(sourceTrees), sourceFocusTrees: sourceTrees,
            renderedInlayWindows: {}, xGridSize: 96, yGridSize: 130, gridBox: {}, dynamicStyleRules: new Map(),
            focusIconGfxFileByName: {}, focusPositionActiveFile: files.focus, focusPositionDocumentVersion: 1 } as any).inlayRenderSignatures.inlay;
    };
    return { html, inlay, files, views, signature,
        view(value: FocusTreeInlay) { return toFocusTreeViews([tree('first', value)])[0]; },
        selectedText(target: { file: string; start: number; end: number }) { return documents.get(target.file)!.getText().slice(target.start, target.end); },
        async render(value: FocusTreeInlay) { return renderInlayWindow(value, new StyleTable(), []); },
        async navigate(message: Record<string, unknown>) {
            await (preview as any).handleMessage(message);
            return opened[opened.length - 1];
        },
        expected: { reference: { file: files.focus, start: inlay.referenceToken!.start, end: inlay.referenceToken!.end },
            second: { file: files.second, start: secondInlay.referenceToken!.start, end: secondInlay.referenceToken!.end },
            definition: { file: files.definition, start: inlay.token!.start, end: inlay.token!.end },
            images: inlay.scriptedImages.map(slot => ({ file: slot.file, start: slot.token!.start, end: slot.token!.end })),
            button: { file: files.definition, start: button.nameToken!.start, end: button.nameToken!.end } },
        shiftReference(amount: number) {
            documents.set(files.focus, { file: files.focus, version: 2, getText: () => ' '.repeat(amount) + focusText,
                positionAt: offset => ({ offset }) });
            return { ...inlay, referenceToken: { ...inlay.referenceToken!,
                start: inlay.referenceToken!.start + amount, end: inlay.referenceToken!.end + amount } as Token };
        } };
}
