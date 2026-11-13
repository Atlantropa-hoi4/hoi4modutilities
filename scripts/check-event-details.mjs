import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserPath = [process.env.HOI4MU_BROWSER_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find(candidate => candidate && fs.existsSync(candidate));
assert.ok(browserPath, 'Set HOI4MU_BROWSER_PATH to a Chromium browser executable.');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoi4mu-event-details-'));
const htmlPath = path.join(tempDir, 'event-details.html');
const bundle = buildSync({ stdin: { contents: `
    export { EventDetailsController } from './webviewsrc/eventdetails';
    export { eventDetailsKeys } from './webviewsrc/eventdetailsstate';
    export { matchesQuery } from './webviewsrc/eventsearch';
`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'browser',
format: 'iife', globalName: 'eventTools' }).outputFiles[0].text;

async function browserCheck() {
    const result = document.getElementById('result');
    let checks = 0;
    const check = (value, message) => { if (!value) { throw new Error(message); } checks++; };
    const settle = () => new Promise(resolve => setTimeout(resolve, 20));
    try {
        const { EventDetailsController, eventDetailsKeys, matchesQuery } = window.eventTools;
        let persisted = { scale: 0.5, xOffset: 120 };
        const write = patch => { persisted = { ...persisted, ...patch }; };
        const controller = new EventDetailsController(() => persisted, write);
        const source = { id: 'event:0', kind: 'event', eventId: 'sample.1', scope: 'ROOT', trigger: true,
            title: { key: 'sample.1.t', text: 'Translated event' },
            nav: { file: 'events/sample.txt', start: 10, end: 20 },
            descriptions: [{ text: { key: 'sample.1.d', text: '<img id="unsafe-markup"> Native dialog details' } }] };
        const option = { id: 'option:1', kind: 'option', name: { key: 'sample.1.a', text: '번역된 선택지' },
            trigger: true, aiChanceScript: 'factor = 90' };
        const append = (owner, node, key) => {
            const card = document.createElement('div');
            document.body.append(card);
            owner.append(card, node, true, key);
            return card;
        };
        const key = eventDetailsKeys([source], []).get(source.id);
        const card = append(controller, source, key);
        const button = card.querySelector('button');
        check(matchesQuery(option, 'SAMPLE.1.A'), 'Option identifier search failed');
        check(matchesQuery(option, '번역된'), 'Option translation search failed');
        check(!matchesQuery(option, '   '), 'Blank search matched an option');
        button.click();
        const first = document.querySelector('dialog');
        check(first instanceof HTMLDialogElement && first.open && first.matches(':modal'), 'Details did not enter the native modal top layer');
        check(first.contains(document.activeElement), 'Native modal did not receive focus');
        check(first.getAttribute('aria-labelledby') === first.querySelector('h2').id, 'Modal title is not associated');
        check(!document.getElementById('unsafe-markup') && first.textContent.includes('<img'), 'Details text was interpreted as markup');
        controller.beginRender();
        card.remove();
        const changed = { ...source, id: 'event:18', nav: { ...source.nav, start: 100, end: 200 },
            descriptions: [{ text: { key: 'new', text: 'Updated details' } }] };
        const changedKey = eventDetailsKeys([changed], []).get(changed.id);
        check(changedKey === key, 'Selection identity changed with traversal IDs or offsets');
        const currentCard = append(controller, changed, changedKey);
        controller.restore();
        const restored = document.querySelector('dialog');
        check(restored !== first && restored.open && restored.matches(':modal'), 'Refresh did not restore the native modal');
        check(restored.textContent.includes('Updated details'), 'Refresh restored stale details');
        first.dispatchEvent(new Event('close'));
        check(persisted.eventDetailsOpen && document.querySelector('dialog') === restored, 'Late close cleared the current modal');
        restored.querySelector('button').click();
        await settle();
        check(!persisted.eventDetailsOpen && !document.querySelector('dialog'), 'Closing did not persist the closed state');
        check(document.activeElement === currentCard.querySelector('button'), 'Closing did not return focus to the current button');
        currentCard.querySelector('button').click();
        const saved = JSON.parse(JSON.stringify(persisted));
        controller.beginRender();
        currentCard.remove();
        persisted = saved;
        const reloaded = new EventDetailsController(() => persisted, write);
        const reloadedCard = append(reloaded, changed, changedKey);
        reloaded.restore();
        check(document.querySelector('dialog')?.matches(':modal') && persisted.eventDetailsOpen, 'Saved selection did not restore after controller reload');
        reloaded.beginRender();
        reloadedCard.remove();
        reloaded.restore();
        check(!document.querySelector('dialog') && !persisted.eventDetailsOpen, 'Removed selection reopened another modal');
        check(document.activeElement === document.getElementById('ev-searchbox'), 'Removed selection did not return focus to search');
        check(persisted.scale === 0.5 && persisted.xOffset === 120, 'Details state overwrote viewport state');
        result.textContent = `PASS ${checks} assertions`;
    } catch (error) {
        result.textContent = `FAIL ${error.stack ?? error}`;
    }
}

fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><input id="ev-searchbox"><pre id="result">PENDING</pre><script>window.__i18ntable={};${bundle}(${browserCheck.toString()})();</script>`);
const browserSandboxArgs = process.argv.includes('--no-sandbox') ? ['--no-sandbox', '--disable-gpu-sandbox'] : [];
const browser = spawnSync(browserPath, [...browserSandboxArgs, '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(tempDir, 'profile'), '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(htmlPath).href],
{ encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
const match = (browser.stdout ?? '').match(/<pre id="result">([\s\S]*?)<\/pre>/);
console.log(match?.[1] ?? JSON.stringify({ status: browser.status, error: browser.error?.message,
    stdout: browser.stdout?.slice(0, 500), stderr: browser.stderr?.slice(-1000) }));
assert.ok(match?.[1].startsWith('PASS '), `Browser event details regression failed. Fixture: ${htmlPath}`);
