// Opt-in real-input benchmark, run by scripts/profile-vscode-mod.mjs, not the smoke suite.
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Commands } from '../../src/constants';
import * as assert from 'node:assert/strict';
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { collectFocusPositionFileMetadata } from '../../src/previewdef/focustree/positioneditmetadata';
import type { FocusPositionFileMetadata } from '../../src/previewdef/focustree/positioneditmetadata';
import { buildFocusPositionWorkspaceEdit } from '../../src/previewdef/focustree/positioneditservice';
import type { FocusPositionMeta } from '../../src/previewdef/focustree/positioneditcommon';

interface WebviewTiming {
    stage?: string;
    timestamp?: number;
    snapshotVersion?: number;
    documentVersion?: number;
    sinceLoadMs?: number;
    applyMs?: number;
    rebuildMs?: number;
    rebindMs?: number;
    changedSlots?: string[];
    source?: string;
    assetLoadMode?: string;
    updateKind?: string;
    payloadBytes?: number;
}

interface DebugState {
    diagnostics?: { focusCount?: number; currentFocusTreeId?: string; renderedFocusHitCount?: number; timestamp?: number };
    webviewTimings?: WebviewTiming[];
    session?: { latestDocumentVersion?: number; traces?: { event?: string; assetLoadMode?: string; source?: string; updateKind?: string }[] };
    performance?: { entries?: PerformanceEntry[]; counters?: unknown[] };
    cachedWorldMap?: { width: number; height: number; provincesCount: number; statesCount: number; warningCount: number; retainedJsonBytes?: number };
    timings?: { loadGeneration: number; loadStartedAt: number; summaryPostedAt?: number; dataCommittedAt?: number };
    hasCommittedWorldMap?: boolean;
    loadInProgress?: boolean;
}

interface PerformanceEntry {
    label: string;
    timestamp: number;
    durationMs: number;
    tags: Record<string, unknown>;
}

type Observe = (command: string, ...args: unknown[]) => Promise<DebugState | undefined>;
const appliedStages: Record<string, true | undefined> = {
    sceneApplied: true, scenePatched: true, visibleAssetsApplied: true, contentUpdated: true,
};

export async function run(): Promise<void> {
    const modRoot = process.env.HOI4MU_PROFILE_MOD;
    const output = process.env.HOI4MU_PROFILE_OUTPUT;
    if (!modRoot || !output) { throw new Error('Launch this benchmark with scripts/profile-vscode-mod.mjs.'); }
    const report: Record<string, unknown> = {
        timestamp: new Date().toISOString(), vscode: vscode.version, node: process.version,
        platform: process.platform, backend: process.env.HOI4MU_COMPUTE_BACKEND ?? 'auto',
        scope: 'Actual desktop extension host and focus webview acknowledgements; no game/mod files are written. Each launch uses isolated extension storage. OS file caches are not flushed.',
        edits: process.env.HOI4MU_PROFILE_EDITS === '1',
        firstPaintDefinition: 'firstPaintMs is the raw firstScenePainted telemetry, not proof of populated structure. shellReadyMs records webviewReady separately; initialEmptyShellPaintMs is identifiable only for snapshot 0. populatedSceneAppliedMs requires a versioned applied timing and nonempty focus diagnostics; it is not a final raster-paint measurement.',
    };
    const results: unknown[] = [];
    report.results = results;
    const memory = () => process.memoryUsage();
    const inputs: unknown[] = [];
    report.inputs = inputs;
    const extension = vscode.extensions.getExtension('server.hoi4modutilities');
    if (!extension) { throw new Error('Development extension not found.'); }
    const alreadyActive = extension.isActive;
    const activationStart = performance.now();
    await extension.activate();
    report.activation = { durationMs: performance.now() - activationStart, alreadyActive };
    for (const artifact of ['dist/extension.js', 'dist/compute-worker.js', 'dist/hoi4_compute.wasm']) {
        const bytes = await fs.readFile(path.join(extension.extensionPath, artifact));
        inputs.push({ file: artifact, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const samples = Number(process.env.HOI4MU_PROFILE_SAMPLES ?? '3');
    const requested: string[] = JSON.parse(process.env.HOI4MU_PROFILE_FOCUS ?? '[]');
    const focuses = requested.length ? requested : await selectFocuses(modRoot);
    const observe: Observe = async (command, ...args) =>
        vscode.commands.executeCommand<DebugState>(command, ...args);
    const persist = async () => {
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, JSON.stringify(report, null, 2));
    };
    try {
        for (const relative of focuses) {
            const uri = vscode.Uri.file(path.join(modRoot, relative));
            const bytes = await fs.readFile(uri.fsPath);
            inputs.push({ file: relative, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
            for (let sample = 0; sample < samples; sample++) {
                await vscode.commands.executeCommand('workbench.action.closeAllEditors');
                const before = memory();
                const histogram = monitorEventLoopDelay({ resolution: 10 });
                histogram.enable();
                const started = performance.now();
                const startedWall = Date.now();
                const document = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(document);
                await vscode.commands.executeCommand(Commands.Preview, uri);
                let firstPaintMs: number | undefined;
                let shellReadyMs: number | undefined;
                let initialEmptyShellPaintMs: number | undefined;
                let populatedSceneAppliedMs: number | undefined;
                let populatedSceneFocusCount: number | undefined;
                let final: DebugState | undefined;
                const entries = new Map<string, unknown>();
                while (performance.now() - started < 180000) {
                    const state = await observe(Commands.DebugFocusTreePreviewState, uri);
                    for (const entry of state?.performance?.entries ?? []) {
                        if (entry.timestamp >= startedWall) { entries.set(JSON.stringify([entry.label, entry.timestamp, entry.tags]), entry); }
                    }
                    const painted = state?.webviewTimings?.find(t => t.stage === 'firstScenePainted' && t.timestamp !== undefined && t.timestamp >= startedWall);
                    if (painted && firstPaintMs === undefined) {
                        firstPaintMs = painted.timestamp! - startedWall;
                    }
                    const shellReady = state?.webviewTimings?.find(t => t.stage === 'webviewReady' && t.timestamp !== undefined && t.timestamp >= startedWall);
                    if (shellReady && shellReadyMs === undefined) { shellReadyMs = shellReady.timestamp! - startedWall; }
                    if (painted?.snapshotVersion === 0 && painted.timestamp !== undefined) {
                        initialEmptyShellPaintMs = painted.timestamp - startedWall;
                    }
                    const populated = state?.webviewTimings?.find(t => (t.stage === 'firstScenePainted' || appliedStages[t.stage ?? ''])
                        && t.documentVersion === document.version && (t.snapshotVersion ?? 0) > 0
                        && t.timestamp !== undefined && t.timestamp >= startedWall);
                    if (populated && (state?.diagnostics?.focusCount ?? 0) > 0 && populatedSceneAppliedMs === undefined) {
                        populatedSceneAppliedMs = populated.timestamp! - startedWall;
                        populatedSceneFocusCount = state?.diagnostics?.focusCount;
                    }
                    const full = state?.session?.traces?.some(t => t.event === 'applySnapshotUpdate' && t.assetLoadMode === 'full');
                    if (full && state?.webviewTimings?.some(t => t.stage === 'visibleAssetsApplied')) { final = state; break; }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                histogram.disable();
                const result = { kind: 'focus', file: relative, sample, cache: sample === 0 ? 'first-open' : 'warm-reopen',
                    startedWall, firstPaintMs, hydratedMs: (final?.webviewTimings?.find(t => t.stage === 'visibleAssetsApplied')?.timestamp ?? Date.now()) - startedWall,
                    shellReadyMs, initialEmptyShellPaintMs, populatedSceneAppliedMs,
                    populatedSceneFocusCount,
                    hydratedObservedMs: performance.now() - started, ok: !!final,
                    memoryBefore: before, memoryAfter: memory(), eventLoopMaxMs: histogram.max / 1e6,
                    eventLoopP95Ms: histogram.percentile(95) / 1e6,
                    diagnostics: final?.diagnostics, timings: final?.webviewTimings, session: final?.session,
                    performance: [...entries.values()], counters: final?.performance?.counters };
                results.push(result);
                console.log('REALMOD_FOCUS', JSON.stringify({ file: relative, sample, firstPaintMs,
                    hydratedObservedMs: result.hydratedObservedMs, ok: result.ok, diagnostics: result.diagnostics,
                    eventLoopMaxMs: result.eventLoopMaxMs }));
                await persist();
                if (!final) { throw new Error(`Focus hydration timed out: ${relative}`); }
                if (process.env.HOI4MU_PROFILE_EDITS === '1' && sample === samples - 1) {
                    await profileFocusEdits(document, relative, sample, bytes, final, observe, results, persist);
                }
            }
        }
        if (process.env.HOI4MU_PROFILE_WORLD === '1') {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            const histogram = monitorEventLoopDelay({ resolution: 10 });
            histogram.enable();
            const started = performance.now();
            const startedWall = Date.now();
            const before = memory();
            await vscode.commands.executeCommand(Commands.PreviewWorld);
            let final: DebugState | undefined;
            const entries = new Map<string, unknown>();
            while (performance.now() - started < 240000) {
                const state = await observe(Commands.DebugWorldMapPreviewState, { includeRetainedSize: false, performanceLimit: 200 });
                for (const entry of state?.performance?.entries ?? []) {
                    if (entry.timestamp >= startedWall) { entries.set(JSON.stringify([entry.label, entry.timestamp, entry.tags]), entry); }
                }
                if (state?.hasCommittedWorldMap && !state.loadInProgress) { final = state; break; }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            histogram.disable();
            const observedReadyMs = performance.now() - started;
            const memoryAfter = memory();
            const detailed = final ? await observe(Commands.DebugWorldMapPreviewState, { includeRetainedSize: true }) : undefined;
            results.push({ kind: 'worldmap', cache: 'first-map-after-focus-index-warmup', ok: !!final,
                startedWall, observedReadyMs, memoryBefore: before, memoryAfter,
                dataCommittedMs: final?.timings?.dataCommittedAt === undefined ? undefined : final.timings.dataCommittedAt - startedWall,
                readinessDefinition: 'Host acknowledgement of complete webview map data; excludes final canvas paint. Legacy bundles may still serialize the retained map during each poll.',
                retainedSizeOutsideMeasurement: final?.timings !== undefined,
                eventLoopMaxMs: histogram.max / 1e6, eventLoopP95Ms: histogram.percentile(95) / 1e6,
                summary: detailed?.cachedWorldMap ?? final?.cachedWorldMap, timings: final?.timings,
                performance: [...entries.values()], counters: final?.performance?.counters });
            await persist();
            if (!final) { throw new Error('World map timed out.'); }
        }
    } catch (error) {
        report.error = error instanceof Error ? error.stack : String(error);
        throw error;
    } finally {
        try { await persist(); }
        finally { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); }
    }
}

async function profileFocusEdits(
    previewDocument: vscode.TextDocument, file: string, sample: number, originalBytes: Buffer,
    initial: DebugState, observe: Observe, results: unknown[], persist: () => Promise<void>,
): Promise<void> {
    const modRoot = process.env.HOI4MU_PROFILE_MOD!;
    const parseDocument = (content: string, sourceFile: string) => {
        const bomOffset = content.startsWith('\uFEFF') ? 1 : 0;
        const root = parseHoi4File(content.slice(bomOffset));
        return { root, bomOffset, metadata: collectFocusPositionFileMetadata(root, sourceFile) };
    };
    const parsed = parseDocument(previewDocument.getText(), file);
    const importedIds = new Set<string>();
    for (const tree of Array.isArray(parsed.root.value) ? parsed.root.value : []) {
        if (tree.name !== 'focus_tree' || !Array.isArray(tree.value)) { continue; }
        const id = tree.value.find(node => node.name === 'id')?.value;
        const treeId = typeof id === 'string' ? id : id && typeof id === 'object' && !Array.isArray(id) ? id.name : undefined;
        if (initial.diagnostics?.currentFocusTreeId && treeId !== initial.diagnostics.currentFocusTreeId) { continue; }
        for (const node of tree.value) {
            if (node.name !== 'shared_focus') { continue; }
            const value = node.value;
            const focusId = typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value) ? value.name : undefined;
            if (focusId) { importedIds.add(focusId); }
        }
    }
    const chooseFocus = (metadata: FocusPositionFileMetadata, sourceFile: string, imported: boolean) => {
        const focuses = Object.values(metadata.focuses).filter((focus): focus is FocusPositionMeta => focus !== undefined);
        const idCounts = new Map<string, number>();
        for (const focus of focuses) { idCounts.set(focus.focusId, (idCounts.get(focus.focusId) ?? 0) + 1); }
        return focuses.find(focus => focus.editable && focus.sourceFile === sourceFile && idCounts.get(focus.focusId) === 1
            && focus.x && focus.y && Number.isInteger(focus.basePosition.x) && Number.isInteger(focus.basePosition.y)
            && (!imported || importedIds.has(focus.focusId)));
    };
    let sourceDocument = previewDocument;
    let sourceFile = file;
    let sourceParsed = parsed;
    let selected = chooseFocus(parsed.metadata, file, false);
    if (!selected) {
        assert.ok(importedIds.size > 0, `No editable local focus or selected-tree shared_focus references found in ${file}.`);
        // Resolve real shared-focus declarations from the mod inventory, never from filename heuristics.
        const candidates = await vscode.workspace.findFiles(new vscode.RelativePattern(modRoot, 'common/national_focus/**/*.txt'), '**/.git/**');
        candidates.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
        for (const candidate of candidates) {
            if (candidate.toString() === previewDocument.uri.toString()) { continue; }
            const content = await fs.readFile(candidate.fsPath, 'utf8');
            if (![...importedIds].some(focusId => content.includes(focusId))) { continue; }
            const relative = path.relative(modRoot, candidate.fsPath);
            const candidateParsed = parseDocument(content, relative);
            const focus = chooseFocus(candidateParsed.metadata, relative, true);
            if (!focus) { continue; }
            sourceDocument = await vscode.workspace.openTextDocument(candidate);
            sourceFile = relative;
            sourceParsed = parseDocument(sourceDocument.getText(), relative);
            selected = chooseFocus(sourceParsed.metadata, relative, true);
            break;
        }
    }
    assert.ok(selected?.x && selected.y, `No unique editable source focus with numeric x/y resolved for ${file}.`);
    const sourceOriginal = sourceDocument.getText();
    const sourceBytes = sourceDocument === previewDocument ? originalBytes : await fs.readFile(sourceDocument.uri.fsPath);
    const targetX = selected.basePosition.x + 1;
    const targetY = selected.basePosition.y + 1;
    const expectedPosition = [
        { start: selected.x.valueRange.start + sourceParsed.bomOffset, end: selected.x.valueRange.end + sourceParsed.bomOffset, text: String(targetX) },
        { start: selected.y.valueRange.start + sourceParsed.bomOffset, end: selected.y.valueRange.end + sourceParsed.bomOffset, text: String(targetY) },
    ].sort((a, b) => b.start - a.start).reduce((text, change) =>
        text.slice(0, change.start) + change.text + text.slice(change.end), sourceOriginal);
    const comment = '# HOI4MU unsaved preview benchmark comment' + (previewDocument.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
    const rootOriginal = previewDocument.getText();
    const expectedComment = rootOriginal.slice(0, parsed.bomOffset) + comment + rootOriginal.slice(parsed.bomOffset);
    for (const mutation of ['comment-edit', 'position-edit'] as const) {
        const document = mutation === 'comment-edit' ? previewDocument : sourceDocument;
        const original = document.getText();
        const bytes = mutation === 'comment-edit' ? originalBytes : sourceBytes;
        const expected = mutation === 'comment-edit' ? expectedComment : expectedPosition;
        const changedFile = mutation === 'comment-edit' ? file : sourceFile;
        const dependency = document.uri.toString() !== previewDocument.uri.toString();
        const cleanup: Record<string, unknown> = { kind: 'focus-edit-cleanup', file, sourceFile: changedFile, mutation, sample, ok: false };
        const initiallyDirty = document.isDirty;
        cleanup.originalTextSha256 = createHash('sha256').update(original).digest('hex');
        cleanup.originalDiskSha256 = createHash('sha256').update(bytes).digest('hex');
        let saves = 0;
        const saveListener = vscode.workspace.onDidSaveTextDocument(saved => {
            if (saved.uri.toString() === document.uri.toString()) { saves++; }
        });
        try {
            assert.equal(initiallyDirty, false, 'The benchmark requires an initially clean source.');
            assert.equal(vscode.workspace.getConfiguration('files', document.uri).get('autoSave'), 'off', 'Resource auto-save must be off.');
            await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
            let edit: vscode.WorkspaceEdit;
            if (mutation === 'comment-edit') {
                edit = new vscode.WorkspaceEdit();
                edit.insert(document.uri, document.positionAt(parsed.bomOffset), comment);
            } else {
                const built = buildFocusPositionWorkspaceEdit(document, selected.focusId, targetX, targetY);
                assert.ifError(built.error);
                assert.ok(built.edit, 'Position builder must produce a WorkspaceEdit.');
                edit = built.edit;
            }
            const edits = edit.entries();
            assert.equal(edits.length, 1, 'Mutation must touch exactly one source document.');
            assert.equal(edits[0][0].toString(), document.uri.toString());
            const planned = [...edits[0][1]].sort((a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start))
                .reduce((text, change) => text.slice(0, document.offsetAt(change.range.start)) + change.newText
                    + text.slice(document.offsetAt(change.range.end)), original);
            assert.equal(planned, expected, 'Edit may change only the intended comment or selected x/y scalar values.');
            const details = { sourceFile: changedFile, dependency, focusId: mutation === 'position-edit' ? selected.focusId : undefined,
                targetLocalX: mutation === 'position-edit' ? targetX : undefined, targetLocalY: mutation === 'position-edit' ? targetY : undefined };
            await measureFocusMutation(previewDocument, document, file, sample, mutation, expected, dependency,
                async () => { assert.equal(await vscode.workspace.applyEdit(edit), true, 'WorkspaceEdit was rejected.'); },
                observe, results, details);
            await persist();
            await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false });
            assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), document.uri.toString(), 'Text editor must own undo, not webview.');
            await measureFocusMutation(previewDocument, document, file, sample, 'undo', original, dependency,
                async () => { await vscode.commands.executeCommand('undo'); },
                observe, results, { ...details, undoOf: mutation, undoCommands: 1 });
            assert.equal(document.getText(), original, 'Exactly one undo must restore the original string.');
            assert.equal(saves, 0, 'The workload must never save.');
            assert.deepEqual(await fs.readFile(document.uri.fsPath), bytes, 'Source disk bytes changed.');
            await persist();
        } finally {
            try {
                await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false });
                let restoredDocument = document;
                if (document.getText() !== original) {
                    // Recovery is unmeasured and never hides a failed single-undo assertion.
                    const restore = new vscode.WorkspaceEdit();
                    restore.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), original);
                    try { cleanup.recoveryWorkspaceEdit = await vscode.workspace.applyEdit(restore); }
                    catch (error) { cleanup.recoveryEditError = error instanceof Error ? error.message : String(error); }
                    if (!cleanup.recoveryWorkspaceEdit && !initiallyDirty) {
                        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
                        restoredDocument = await vscode.workspace.openTextDocument(document.uri);
                        cleanup.recoveryDiscard = true;
                    }
                }
                assert.equal(restoredDocument.getText(), original, 'Finally must restore the editor string.');
                cleanup.originalTextRestored = true;
                cleanup.restoredSourceDocumentVersion = restoredDocument.version;
                if (restoredDocument.isDirty && !initiallyDirty) {
                    await vscode.window.showTextDocument(restoredDocument, { viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false });
                    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
                }
                assert.deepEqual(await fs.readFile(document.uri.fsPath), bytes, 'Finally must preserve original disk bytes.');
                assert.deepEqual(await fs.readFile(previewDocument.uri.fsPath), originalBytes, 'Root preview disk bytes must remain unchanged.');
                if (dependency) { assert.equal(previewDocument.getText(), rootOriginal, 'Imported edit must preserve root text.'); }
                assert.equal(saves, 0, 'Cleanup must not save.');
                cleanup.diskBytesUnchanged = true;
                cleanup.saveEvents = saves;
                cleanup.ok = true;
            } catch (error) {
                cleanup.error = error instanceof Error ? error.stack : String(error);
                throw error;
            } finally {
                saveListener.dispose();
                results.push(cleanup);
                await persist();
            }
        }
    }
}

async function measureFocusMutation(
    previewDocument: vscode.TextDocument, sourceDocument: vscode.TextDocument, file: string, sample: number,
    mutation: 'comment-edit' | 'position-edit' | 'undo', expected: string, dependency: boolean,
    mutate: () => Promise<void>, observe: Observe, results: unknown[], details: Record<string, unknown>,
): Promise<void> {
    const before = await observe(Commands.DebugFocusTreePreviewState, previewDocument.uri);
    assert.ok(before, 'The original focus preview must remain open.');
    const oldTimings = new Set((before.webviewTimings ?? []).map(timing => JSON.stringify(timing)));
    const previousSnapshotVersion = Math.max(0, ...(before.webviewTimings ?? []).map(timing => timing.snapshotVersion ?? 0));
    const oldEntries = new Set((before.performance?.entries ?? []).map(entry => JSON.stringify(entry)));
    const entries = new Map<string, PerformanceEntry>();
    const newTimings = new Map<string, WebviewTiming>();
    const previousSourceDocumentVersion = sourceDocument.version;
    const previewDocumentVersion = previewDocument.version;
    const memoryBefore = process.memoryUsage();
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    const row: Record<string, unknown> = {
        kind: 'focus-edit', mutation, file, sample, ...details, ok: false,
        cache: sample === 0 ? 'final-first-open-hydrated' : 'final-warm-open-hydrated',
        previousSourceDocumentVersion, previousPreviewDocumentVersion: previewDocumentVersion, previousSnapshotVersion,
        acknowledgementDefinition: 'New applied-stage webview timing; timestamp >= mutation start, exact current preview documentVersion, snapshotVersion > pre-mutation maximum, dependency source required for imported source edits. Source document version is separately verified. Existing protocol-v4 contentUpdated is applied, not contentUpdateReceived.',
        performanceScope: 'New global host entries during this serial mutation; may include unrelated host work. Applied acknowledgement excludes host-only completion and timers.',
    };
    results.push(row);
    histogram.enable();
    const started = performance.now();
    const startedWall = Date.now();
    row.startedWall = startedWall;
    let final: DebugState | undefined;
    let acknowledgement: WebviewTiming | undefined;
    try {
        await mutate();
        row.workspaceMutationMs = performance.now() - started;
        row.sourceDocumentVersion = sourceDocument.version;
        row.previewDocumentVersion = previewDocument.version;
        assert.ok(sourceDocument.version > previousSourceDocumentVersion, 'Mutation must advance source version.');
        if (dependency) { assert.equal(previewDocument.version, previewDocumentVersion, 'Imported edit must not modify the root document.'); }
        assert.equal(sourceDocument.getText(), expected, mutation === 'undo'
            ? 'Exactly one undo failed to restore original text.' : 'Mutation changed unintended source fields.');
        row.contentVerified = true;
        row.sourceTextSha256 = createHash('sha256').update(sourceDocument.getText()).digest('hex');
        while (performance.now() - started < 180000) {
            const state = await observe(Commands.DebugFocusTreePreviewState, previewDocument.uri);
            for (const entry of state?.performance?.entries ?? []) {
                const key = JSON.stringify(entry);
                if (entry.timestamp >= startedWall && !oldEntries.has(key)) { entries.set(key, entry); }
            }
            for (const timing of state?.webviewTimings ?? []) {
                const key = JSON.stringify(timing);
                if (timing.timestamp !== undefined && timing.timestamp >= startedWall && !oldTimings.has(key)
                    && timing.documentVersion === previewDocument.version && (timing.snapshotVersion ?? 0) > previousSnapshotVersion) {
                    newTimings.set(key, timing);
                }
            }
            acknowledgement = [...newTimings.values()].find(timing => appliedStages[timing.stage ?? '']
                && (!dependency || timing.source === 'dependency'));
            if (acknowledgement) { final = state; break; }
            await new Promise<void>(resolve => setTimeout(resolve, 25));
        }
        assert.ok(final && acknowledgement, `Applied webview acknowledgement missing: ${file} ${mutation}, preview version ${previewDocument.version}, source version ${sourceDocument.version}.`);
        assert.equal(sourceDocument.getText(), expected, 'Source changed while waiting for preview.');
        assert.equal(acknowledgement.documentVersion, previewDocument.version);
        assert.equal(sourceDocument.version, row.sourceDocumentVersion, 'Source version changed during acknowledgement wait.');
        assert.equal(previewDocument.version, row.previewDocumentVersion, 'Preview version changed during acknowledgement wait.');
        row.acknowledgement = acknowledgement;
        row.acknowledgedPreviewDocumentVersion = acknowledgement.documentVersion;
        row.acknowledgedSnapshotVersion = acknowledgement.snapshotVersion;
        row.elapsedAcknowledgementMs = acknowledgement.timestamp! - startedWall;
        row.acknowledgementObservedMs = performance.now() - started;
        row.stageCosts = { applyMs: acknowledgement.applyMs, rebuildMs: acknowledgement.rebuildMs, rebindMs: acknowledgement.rebindMs };
        row.session = final.session;
        row.diagnostics = final.diagnostics;
        row.ok = true;
        console.log('REALMOD_FOCUS_EDIT', JSON.stringify({ file, mutation, sourceDocumentVersion: sourceDocument.version,
            previewDocumentVersion: previewDocument.version, snapshotVersion: acknowledgement.snapshotVersion,
            elapsedAcknowledgementMs: row.elapsedAcknowledgementMs }));
    } catch (error) {
        row.error = error instanceof Error ? error.stack : String(error);
        throw error;
    } finally {
        histogram.disable();
        row.elapsedObservedMs = performance.now() - started;
        row.eventLoopMaxMs = histogram.max / 1e6;
        row.eventLoopP95Ms = histogram.percentile(95) / 1e6;
        row.memoryBefore = memoryBefore;
        row.memoryAfter = process.memoryUsage();
        row.timings = [...newTimings.values()];
        row.performance = [...entries.values()];
        const hostStageCosts: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
        for (const entry of entries.values()) {
            const costs = hostStageCosts[entry.label] ??= { count: 0, totalMs: 0, maxMs: 0 };
            costs.count++;
            costs.totalMs += entry.durationMs;
            costs.maxMs = Math.max(costs.maxMs, entry.durationMs);
        }
        row.hostStageCosts = hostStageCosts;
    }
}

async function selectFocuses(modRoot: string): Promise<string[]> {
    const directory = path.join(modRoot, 'common', 'national_focus');
    const files = await fs.readdir(directory);
    const candidates = await Promise.all(files.filter(file => file.endsWith('.txt') && !/shared|titlebar/i.test(file))
        .map(async file => ({ file, size: (await fs.stat(path.join(directory, file))).size })));
    candidates.sort((a, b) => b.size - a.size);
    const selected: string[] = [];
    for (const { file } of candidates) {
        if (/\bfocus_tree\s*=\s*\{/.test(await fs.readFile(path.join(directory, file), 'utf8'))) {
            selected.push(path.join('common', 'national_focus', file));
            if (selected.length >= 2) { break; }
        }
    }
    if (!selected.length) { throw new Error('No representative focus_tree source found.'); }
    return selected;
}
