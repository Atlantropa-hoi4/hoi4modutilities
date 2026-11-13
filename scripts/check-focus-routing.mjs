// Run after npm run compile-tests. Uses real host templates and the retained browser scene.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const browserPath = [process.env.HOI4MU_BROWSER_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find(candidate => candidate && fs.existsSync(candidate));
assert.ok(browserPath, 'Set HOI4MU_BROWSER_PATH to a Chromium browser executable.');
assert.ok(fs.existsSync(path.join(root, 'out/src/previewdef/focustree/presentation.js')),
    'Run npm run compile-tests before this browser check.');

const Module = require('node:module');
const originalLoad = Module._load;
const svgUri = (width, height, content) => 'data:image/svg+xml;base64,'
    + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${content}</svg>`).toString('base64');
const sprites = {
    GFX_focus_unavailable: { width: 160, height: 44,
        uri: svgUri(160, 44, '<rect x="1" y="1" width="158" height="42" fill="#07110e" stroke="#f88"/>') },
    GFX_routing_ornament: { width: 360, height: 256,
        uri: svgUri(360, 256, '<circle cx="280" cy="40" r="2" fill="#777"/>') },
};
const mocks = {
    vscode: { env: { language: 'en' } },
    telemetry: { sendEvent: () => undefined },
    context: { contextContainer: { current: null } },
    debug: { debug: () => undefined, error: () => undefined },
    imagecache: { getSpriteByGfxName: async name => {
        const sprite = sprites[name];
        return sprite && { id: name, width: sprite.width, height: sprite.height,
            getFrame: frame => frame === 0 ? { uri: sprite.uri } : undefined };
    } },
};
// A window wider than its slot, with margins and a nested body, whose symbol is right of its middle.
const customGui = `guiTypes = { containerWindowType = {
    name = national_focus_item size = { width = 233 height = 171 } margin = { left = 11 top = 6 right = 3 bottom = 2 }
    containerWindowType = { name = focus_body position = { x = 17 y = 4 } size = { width = 190 height = 150 }
        iconType = { name = symbol position = { x = 9 y = 58 } orientation = center_up centerposition = yes }
        iconType = { name = bg position = { x = 104 y = 128 } centerposition = yes spriteType = GFX_focus_unavailable }
        instantTextBoxType = { name = name position = { x = 24 y = 112 } maxWidth = 160 maxHeight = 30 format = center }
    }
} }`;
let layouts;
let hostCss;
Module._load = function (request, parent, main) {
    const name = request.split(/[\\/]/).pop();
    return Object.hasOwn(mocks, name) ? mocks[name] : originalLoad.call(this, request, parent, main);
};
try {
    const { parseHoi4File } = require(path.join(root, 'out/src/hoiformat/hoiparser.js'));
    const { convertNodeToJson } = require(path.join(root, 'out/src/hoiformat/schema.js'));
    const { guiFileSchema } = require(path.join(root, 'out/src/hoiformat/gui.js'));
    const { StyleTable } = require(path.join(root, 'out/src/util/styletable.js'));
    const { findFocusWindow, FocusGuiRenderer } = require(path.join(root, 'out/src/previewdef/focustree/presentation.js'));
    const { renderFocusCardTemplate } = require(path.join(root, 'out/src/previewdef/focustree/focusrender.js'));
    const styles = new StyleTable();
    const renderLayout = async (name, guiText, slot) => {
        const gui = convertNodeToJson(parseHoi4File(guiText), guiFileSchema);
        const item = findFocusWindow(gui.guitypes.flatMap(value => value.containerwindowtype), 'national_focus_item');
        const renderer = new FocusGuiRenderer({ item, styles: [] }, styles, [], slot.width, slot.height);
        return { name, slot, template: renderFocusCardTemplate(styles, slot.width, await renderer.renderTemplate({})) };
    };
    // The first layout also drives the routing checks.
    layouts = [
        await renderLayout('routing.gui', fs.readFileSync(path.join(root, 'test/fixtures/focus/routing.gui'), 'utf8'), { width: 96, height: 130 }),
        await renderLayout('custom-gui', customGui, { width: 97, height: 141 }),
        { name: 'default-card', slot: { width: 96, height: 130 } },
    ];
    hostCss = styles.toStyleContent();
} finally {
    Module._load = originalLoad;
}

const bundle = buildSync({
    stdin: { contents: "import { FocusScene } from './webviewsrc/focustree/scene'; import { currentScale, setState } from './webviewsrc/util/common'; window.routingApi = { FocusScene, currentScale, setState };",
        resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'browser', format: 'iife', write: false,
    define: { VERSION: '"test"', EXTENSION_ID: '"test"' },
}).outputFiles[0].text;

function browserCheck(data) {
    const check = (condition, message) => { if (!condition) { throw new Error(message); } };
    const host = document.getElementById('scene');
    const result = document.getElementById('result');
    const settle = async () => { for (let index = 0; index < 4; index++) { await new Promise(resolve => setTimeout(resolve, 0)); } };
    const glyphs = document.getElementById('glyphs');
    const definitions = [
        ['swords', 0, 1, 'Swords of the Superculture'],
        ['greasing', 2, 1, 'Greasing the Wheels of Progress'],
        ['orbital', 5, 1, 'Orbital Support'],
        ['past', 1, 2, 'Their Past'],
        ['future', 5, 2, 'Our Future'],
        ['march', 3, 3, 'The March of Progress'],
    ];
    const originalItems = definitions.map(([id, gridX, gridY]) => ({ id, gridX, gridY, connections: [] }));
    originalItems[3].connections = [{ target: 'swords', targetType: 'parent', style: '1px solid #8af' },
        { target: 'greasing', targetType: 'parent', style: '1px solid #8af' },
        { target: 'future', targetType: 'related', style: '1px solid #f66' }];
    originalItems[4].connections = [{ target: 'greasing', targetType: 'parent', style: '1px solid #8af' },
        { target: 'orbital', targetType: 'parent', style: '1px solid #8af' }];
    originalItems[5].connections = [{ target: 'past', targetType: 'parent', style: '1px dashed #8af' },
        { target: 'future', targetType: 'parent', style: '1px dashed #8af' }];
    const createInputs = template => new Map(definitions.map(([id, x, y, displayName]) => [id, {
        focus: { id, x, y, displayName, icon: [{ icon: id, condition: { type: 'and', items: [] } }],
            file: 'routing.txt', sourceFile: 'routing.txt', editable: true },
        template, exprs: [], activeFile: 'routing.txt', completable: false, labelMode: 'name',
    }]));
    const inputs = createInputs(data.layouts[0].template);
    const hooks = { onNodeRendered() {}, onEdgeRendered() {}, onNodesRemoved() {}, onMaterialized() {} };
    const close = (left, right) => Math.abs(left - right) < 0.05;
    // Preview zoom is clamped by normalizePreviewScale, so only supported (including fractional)
    // scales are rendered; an unsupported one would desync the CSS scale from scene measurement.
    const zoomScales = [0.2, 0.25, 0.33, 0.5, 0.75, 1];
    const applyZoom = scale => {
        window.routingApi.setState({ scale });
        check(window.routingApi.currentScale() === scale, `${scale} is not a supported preview zoom`);
        host.style.transform = `scale(${scale})`;
    };
    const placeholderCss = definitions.map(([id]) => `.st-focus-icon-${id}{width:56px;height:56px;background:#587}`).join('');
    const hydratedCss = definitions.map(([id]) => {
        const width = id === 'past' || id === 'future' ? 176 : 96;
        const height = id === 'past' ? 128 : id === 'future' ? 160 : 64;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="M ${width / 2} 12 L ${width - 16} ${height / 2} L ${width / 2} ${height - 12} L 16 ${height / 2} Z" fill="#446655" stroke="#ccd"/></svg>`;
        return `.st-focus-icon-${id}{width:${width}px;height:${height}px;background:transparent url("data:image/svg+xml,${encodeURIComponent(svg)}") center/contain no-repeat}`;
    }).join('');
    const rail = (edge, axis) => edge.points.find((point, index) => index > 0
        && point[axis] === edge.points[index - 1][axis]
        && point[axis === 'x' ? 'y' : 'x'] !== edge.points[index - 1][axis === 'x' ? 'y' : 'x'])?.[axis];
    let checks = 0;
    const run = async () => {
        for (const scale of zoomScales) {
            for (const format of ['up', 'down', 'left', 'right']) {
                applyZoom(scale);
                let items = originalItems.map(item => ({ ...item }));
                const scene = new window.routingApi.FocusScene(0, hooks);
                const request = () => ({ treeId: 'routing', items,
                    positions: Object.fromEntries(items.map(item => [item.id, { x: item.gridX, y: item.gridY }])),
                    geometryOptions: { items, format, slotSize: { width: 96, height: 130 },
                        padding: { left: 30, top: 60, right: 30, bottom: 60 } },
                    getCardInput: id => inputs.get(id), isChecked: () => false, priorityFocusIds: new Set(),
                });
                const verify = stage => {
                    const geometry = scene.currentGeometry;
                    const axis = format === 'left' || format === 'right' ? 'x' : 'y';
                    const siblings = geometry.edges.filter(edge => edge.kind === 'prerequisite'
                        && (edge.targetId === 'past' || edge.targetId === 'future'));
                    const rails = siblings.map(edge => rail(edge, axis)).filter(value => value !== undefined);
                    check(new Set(rails).size === 1, `${stage}/${format}/${scale}: parallel prerequisite rails`);
                    for (const edge of geometry.edges) {
                        const element = scene.getEdgeElement(edge.id);
                        check(element && element.getAttribute('d') === edge.path, `${stage}: stale SVG path`);
                        if (edge.kind !== 'prerequisite') { continue; }
                        const icon = geometry.nodes[edge.targetId].exclusiveVisual;
                        const end = edge.points[edge.points.length - 1];
                        check(Math.abs(end.x - icon.x - icon.width / 2) < 0.01
                            && Math.abs(end.y - icon.y - icon.height / 2) < 0.01, `${stage}: detached icon endpoint`);
                        if (format === 'up') {
                            const body = geometry.nodes[edge.sourceId].connectionVisual;
                            check(Math.abs(edge.points[0].y - body.y - body.height - geometry.anchorGap) < 0.01,
                                `${stage}: outgoing stem uses transparent symbol padding`);
                            check(edge.points[1].y >= edge.points[0].y, `${stage}: backwards parent bend`);
                        }
                    }
                    checks++;
                };
                document.body.dataset.previewLabelMode = 'name';
                document.body.dataset.focusFrames = 'true';
                document.body.dataset.focusDecorations = 'true';
                glyphs.textContent = placeholderCss;
                scene.render(host, request());
                await settle();
                verify('placeholder');
                glyphs.textContent = hydratedCss;
                scene.measureAllMounted();
                await settle();
                verify('hydrated');
                for (const frames of ['false', 'true']) {
                    document.body.dataset.focusFrames = frames;
                    scene.measureAllMounted();
                    await settle();
                    verify(`frames-${frames}`);
                }
                const paths = scene.currentGeometry.edges.map(edge => edge.path);
                document.body.dataset.focusDecorations = 'false';
                scene.measureAllMounted();
                await settle();
                check(paths.every((value, index) => value === scene.currentGeometry.edges[index].path), 'Ornaments changed connection paths');
                verify('decorations-off');
                for (const mode of ['id', 'name']) {
                    document.body.dataset.previewLabelMode = mode;
                    scene.measureAllMounted();
                    await settle();
                    verify(`labels-${mode}`);
                }
                items[1] = { ...items[1], gridY: 0 };
                const result = scene.render(host, request());
                check(result.reset === false && result.movedCount > 0, 'Position edit unexpectedly reset the scene');
                await settle();
                for (const edge of scene.currentGeometry.edges) {
                    check(scene.getEdgeElement(edge.id)?.getAttribute('d') === edge.path, 'Position edit left stale SVG routes');
                }
                checks++;
                scene.clear();
            }
        }

        // Card boxes are the slots used for hit testing, selection, snapping, and the edit-mode
        // outline. Every GUI size and zoom must keep the symbol on their center column.
        const verifyAlignment = (scene, scale, stage) => {
            const sceneRect = scene.root.getBoundingClientRect();
            for (const node of Object.values(scene.currentGeometry.nodes)) {
                const card = scene.getCard(node.id);
                const box = card.getBoundingClientRect();
                check(close(box.left, sceneRect.left + node.slot.x * scale) && close(box.top, sceneRect.top + node.slot.y * scale)
                    && close(box.width, node.slot.width * scale) && close(box.height, node.slot.height * scale),
                    `${stage}: ${node.id} card box is not its grid slot`);
                const symbol = card.querySelector('.focus-gui-symbol, .st-focus-icon-image').getBoundingClientRect();
                const symbolX = symbol.left + symbol.width / 2;
                check(close(symbolX, box.left + box.width / 2),
                    `${stage}: ${node.id} symbol is ${((symbolX - box.left - box.width / 2) / scale).toFixed(2)}px off its slot center`);
                check(close(node.exclusiveVisual.x + node.exclusiveVisual.width / 2, node.slot.x + node.slot.width / 2),
                    `${stage}: ${node.id} measured symbol anchor left its slot center`);
                check(document.elementFromPoint(symbolX, symbol.top + symbol.height / 2)?.closest('[data-focus-id]') === card,
                    `${stage}: ${node.id} symbol does not hit its own focus`);
            }
            checks++;
        };
        for (const layout of data.layouts) {
            const layoutInputs = createInputs(layout.template);
            for (const scale of zoomScales) {
                applyZoom(scale);
                // Positions keep every symbol inside an 800x600 headless viewport for hit testing.
                let items = [{ id: 'swords', gridX: 0, gridY: 0, connections: [] },
                    { id: 'past', gridX: 3, gridY: 0, connections: [{ target: 'swords', targetType: 'parent', style: '1px solid #8af' }] }];
                const scene = new window.routingApi.FocusScene(0, hooks);
                const request = () => ({ treeId: 'alignment', items,
                    positions: Object.fromEntries(items.map(item => [item.id, { x: item.gridX, y: item.gridY }])),
                    geometryOptions: { items, format: 'up', slotSize: layout.slot,
                        padding: { left: 30, top: 60, right: 30, bottom: 60 } },
                    getCardInput: id => layoutInputs.get(id), isChecked: () => false, priorityFocusIds: new Set(),
                });
                const stage = `${layout.name}/${scale}`;
                document.body.dataset.focusFrames = 'true';
                document.body.dataset.focusDecorations = 'true';
                glyphs.textContent = placeholderCss;
                scene.render(host, request());
                await settle();
                verifyAlignment(scene, scale, `${stage}/placeholder`);
                glyphs.textContent = hydratedCss;
                scene.measureAllMounted();
                await settle();
                verifyAlignment(scene, scale, `${stage}/hydrated`);
                items = [items[0], { ...items[1], gridX: 2, gridY: 1 }];
                check(scene.render(host, request()).reset === false, `${stage}: position edit reset the scene`);
                await settle();
                verifyAlignment(scene, scale, `${stage}/moved`);
                scene.clear();
            }
        }
        result.textContent = `PASS ${checks} retained-scene browser checks`;
    };
    run().catch(error => { result.textContent = 'FAIL ' + error.stack; });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoi4mu-routing-browser-'));
const htmlPath = path.join(tempDir, 'routing.html');
// Like VS Code, the stub keeps webview state, so measurements read the current zoom.
const setup = `window.acquireVsCodeApi=()=>{let state;return{getState:()=>state,setState(value){state=value;},postMessage(){}};};window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);window.cancelAnimationFrame=clearTimeout;`;
// The slot rule mirrors the preview shell in contentbuilder.ts; cards fill their grid slot.
const css = `body{margin:0;background:#1b1b26}#scene{position:relative;transform-origin:0 0}#focus-gridbox>.focus-node-layer>.focus{position:absolute;left:0;top:0;width:var(--focus-slot-width);height:var(--focus-slot-height)}.preview-label-id-text{display:none}body[data-preview-label-mode="id"] .preview-label-id-text{display:inline}body[data-preview-label-mode="id"] .preview-label-name-text{display:none}body[data-focus-frames="false"] .focus-frame-gfx{display:none}body[data-focus-decorations="false"] .focus-decoration-gfx{display:none}`;
const call = `(${browserCheck.toString()})(${JSON.stringify({ layouts })});`;
fs.writeFileSync(htmlPath, `<!doctype html><style>${hostCss}${css}</style><style id="glyphs"></style><div id="scene"></div><pre id="result">PENDING</pre><script>${setup}${bundle}${call}</script>`);
const browser = spawnSync(browserPath, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(tempDir, 'profile'), '--virtual-time-budget=10000', '--dump-dom', pathToFileURL(htmlPath).href],
{ encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
const match = (browser.stdout ?? '').match(/<pre id="result">([\s\S]*?)<\/pre>/);
console.log(match?.[1] ?? browser.error?.message ?? browser.stderr.slice(-1000));
assert.ok(match?.[1].startsWith('PASS '), `Browser routing regression failed. Fixture: ${htmlPath}`);
