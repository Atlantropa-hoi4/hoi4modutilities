import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';

// Run npm run compile-tests first. This check uses a real GUI render, browser event
// delegation, and the host navigation handler, without screenshots or UI automation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { withInlayNavigationFixture } = require('../out/test/inlayNavigationFixture.js');
const browserPath = [process.env.HOI4MU_BROWSER_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find(candidate => candidate && fs.existsSync(candidate));
assert.ok(browserPath, 'Set HOI4MU_BROWSER_PATH to a Chromium browser executable.');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoi4mu-inlay-navigation-'));
const htmlPath = path.join(tempDir, 'inlay-navigation.html');
const bundle = buildSync({ stdin: { contents: `
    export { runtime } from './webviewsrc/focustree/runtime';
    export { getInlayNavigationTarget } from './webviewsrc/focustree/navigation';
    export { subscribeNavigatorDelegation } from './webviewsrc/util/common';
`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'browser',
format: 'iife', globalName: 'inlayTools' }).outputFiles[0].text;
const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c');

function browserCheck(fixture) {
    const result = document.getElementById('result');
    const messages = [];
    let checks = 0;
    const check = (value, message) => { if (!value) { throw new Error(message); } checks++; };
    try {
        const { runtime, getInlayNavigationTarget, subscribeNavigatorDelegation } = window.inlayTools;
        const root = document.getElementById('content');
        root.innerHTML = fixture.html;
        const windowRoot = root.querySelector('[data-inlay-id="inlay"]');
        const ordinary = windowRoot.querySelector('[start]');
        check(windowRoot !== null && ordinary !== null, 'Host-rendered inlay or ordinary GUI child is missing');
        check(root.querySelectorAll('.navigator').length === 4, 'GUI children created extra source navigators');
        check(windowRoot.getAttribute('file') === fixture.expected.reference.file, 'Reference path escaping changed the filename');
        check(!windowRoot.getAttributeNames().includes('quoted.txt'), 'Quoted filename created an attribute');
        runtime.renderedFocusTree = fixture.views[0];
        runtime.focusTrees = fixture.views;
        runtime.selectedFocusTreeIndex = 0;
        window.focusPositionDocumentVersion = 1;
        subscribeNavigatorDelegation(root, getInlayNavigationTarget);
        subscribeNavigatorDelegation(root, getInlayNavigationTarget);
        const click = (element, expected, label) => {
            const count = window.__messages.length;
            element.click();
            check(window.__messages.length === count + 1, label + ': click did not send exactly one message');
            const message = window.__messages.at(-1);
            check(message.command === 'navigate' && message.file === expected.file && message.start === expected.start
                && message.end === expected.end, label + ': wrong source target ' + JSON.stringify(message));
            messages.push({ message, expected });
        };
        click(windowRoot, fixture.expected.reference, 'Window background');
        click(ordinary, fixture.expected.reference, 'Ordinary GUI child');
        check(ordinary.closest('.navigator') === windowRoot, 'Ordinary GUI child retained a GUI-offset navigator');
        for (const [target, label] of [
            [fixture.expected.images[0], 'Scripted icon'],
            [fixture.expected.images[1], 'Scripted image button'],
            [fixture.expected.button, 'Scripted button'],
        ]) {
            const navigator = [...root.querySelectorAll('.navigator')].find(element =>
                element.getAttribute('file') === target.file && Number(element.getAttribute('start')) === target.start);
            check(navigator !== undefined, label + ': definition navigator missing');
            check(navigator.getAttribute('file') === fixture.expected.definition.file, label + ': escaped definition filename changed');
            click(navigator.firstElementChild ?? navigator, target, label);
        }
        // Selecting another tree can precede the asynchronous scene replacement.
        runtime.selectedFocusTreeIndex = 1;
        runtime.selectedFocusTreeId = fixture.views[1].id;
        click(ordinary, fixture.expected.reference, 'Old scene while next tree loads');
        runtime.renderedFocusTree = fixture.views[1];
        click(ordinary, fixture.expected.second, 'Second tree sharing the first HTML template');
        runtime.renderedFocusTree = fixture.shiftedView;
        window.focusPositionDocumentVersion = 2;
        click(ordinary, fixture.shiftedTarget, 'Updated source range with retained HTML');
        check(window.__messages.at(-1).documentVersion === 2, 'Updated source version was not sent');
        const button = document.createElement('button');
        windowRoot.append(button);
        const count = window.__messages.length;
        button.click();
        check(window.__messages.length === count, 'A native input control triggered source navigation');
        result.textContent = JSON.stringify({ status: 'PASS', checks, messages });
    } catch (error) {
        result.textContent = JSON.stringify({ status: 'FAIL', error: error.stack ?? String(error) });
    }
}

await withInlayNavigationFixture(async fixture => {
    const shifted = { ...fixture.inlay, referenceToken: { ...fixture.inlay.referenceToken,
        start: fixture.inlay.referenceToken.start + 27, end: fixture.inlay.referenceToken.end + 27 } };
    const data = { html: fixture.html, views: fixture.views, expected: fixture.expected,
        shiftedView: fixture.view(shifted), shiftedTarget: fixture.view(shifted).inlayWindows[0].navigation };
    const bootstrap = `window.__i18ntable={};window.__messages=[];function acquireVsCodeApi(){return {getState:()=>({}),setState:()=>{},postMessage:message=>window.__messages.push(message)}}`;
    fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><div id="content"></div><pre id="result">PENDING</pre><script>${bootstrap};${bundle};(${browserCheck.toString()})(${scriptJson(data)});</script>`);
    const sandboxArgs = process.argv.includes('--no-sandbox') ? ['--no-sandbox', '--disable-gpu-sandbox'] : [];
    const browser = spawnSync(browserPath, [...sandboxArgs, '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--user-data-dir=' + path.join(tempDir, 'profile'), '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(htmlPath).href],
    { encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    const match = (browser.stdout ?? '').match(/<pre id="result">([\s\S]*?)<\/pre>/);
    const decodeHtml = value => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.ok(match, `Browser produced no result: ${browser.error?.message ?? browser.stderr?.slice(-1000)}. Fixture: ${htmlPath}`);
    const result = JSON.parse(decodeHtml(match[1]));
    assert.strictEqual(result.status, 'PASS', `${result.error}. Fixture: ${htmlPath}`);
    for (const { message, expected } of result.messages) {
        if (expected.file === data.shiftedTarget.file && expected.start === data.shiftedTarget.start) {
            fixture.shiftReference(27);
        }
        assert.deepStrictEqual(await fixture.navigate(message), expected, 'The host opened a different file or selection');
        const selected = expected.file !== fixture.files.definition ? 'inlay_window'
            : expected.start === fixture.expected.images[0].start ? 'image_slot'
            : expected.start === fixture.expected.images[1].start ? 'image_button' : 'button_slot';
        assert.strictEqual(fixture.selectedText(expected), selected, 'The source selection does not identify the clicked control');
    }
    console.log(`PASS ${result.checks} browser assertions and ${result.messages.length} host navigation checks`);
});
