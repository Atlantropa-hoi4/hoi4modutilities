import * as vscode from 'vscode';
import { ddsToPng, ddsToPngBufferAsync, EncodedImage, tgaToPng } from './util/image/converter';
import { PNG } from 'pngjs';
import { localize } from './util/i18n';
import { DDS } from './util/image/dds';
import { html, htmlEscape } from './util/html';
import { StyleTable } from './util/styletable';
import { sendEvent } from './util/telemetry';
import { forceError, toArrayBuffer, UserError } from './util/common';
import { readFile } from './util/vsccommon';
import { getStaticResourceRoots } from './util/webview';
import { formatByteSize, isImagePreviewWithinLimit, maxCustomEditorImageBytes } from './util/image/previewlimits';
import { measureAsync, measureSync, recordPerf } from './util/perf';
import { runCancellableOperation } from './services/cancellableOperation';

abstract class CommonViewProvider implements vscode.CustomReadonlyEditorProvider {
    public async openCustomDocument(uri: vscode.Uri) {
        // Don't try opening it as text
        return { uri, dispose: () => { } };
    }

    public async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() => controller.abort());
        const panelDisposal = webviewPanel.onDidDispose?.(() => controller.abort());
        if (token.isCancellationRequested) {
            controller.abort();
        }
        try {
            this.onOpen();
            webviewPanel.webview.options = {
                enableScripts: false,
                localResourceRoots: getStaticResourceRoots(),
            };

            const buffer = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: localize('imagePreview.loading', 'Loading image preview...'),
            }, () => this.readPreviewBuffer(document.uri, token));

            if (buffer === null) {
                return;
            }

            const png = await measureAsync('imagePreview.process', { provider: this.previewKind, bytes: buffer.byteLength }, () =>
                this.getEncodedImage(buffer, controller.signal));
            if (controller.signal.aborted) {
                return;
            }
            const pngBuffer = png.pngBuffer;
            recordPerf('imagePreview.totalBytes', 0, {
                provider: this.previewKind,
                sourceBytes: buffer.byteLength,
                pngBytes: pngBuffer.byteLength,
            });
            const styleTable = new StyleTable();

            webviewPanel.webview.html = html(
                webviewPanel.webview,
                `<div class="${styleTable.oneTimeStyle('imagePreview', () => `width:${png.width}px;height:${png.height}px;`)}">
                    <img src="data:image/png;base64,${pngBuffer.toString('base64')}"/>
                </div>`,
                [],
                [styleTable]
            );
        } catch (e) {
            if (!controller.signal.aborted) {
                webviewPanel.webview.html = `${localize('error', 'Error')}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
            }
        } finally {
            cancellation.dispose();
            panelDisposal?.dispose();
        }
    }

    protected async getEncodedImage(buffer: Buffer, _signal: AbortSignal): Promise<EncodedImage> {
        const png = measureSync('imagePreview.decode', { provider: this.previewKind, bytes: buffer.byteLength }, () => this.getPng(buffer));
        const pngBuffer = measureSync('imagePreview.encodePng', { provider: this.previewKind, width: png.width, height: png.height }, () => PNG.sync.write(png));
        return { width: png.width, height: png.height, pngBuffer };
    }

    private async readPreviewBuffer(uri: vscode.Uri, token: vscode.CancellationToken): Promise<Buffer | null> {
        const stat = await runCancellableOperation(token, () => vscode.workspace.fs.stat(uri));
        if (stat === null) {
            return null;
        }
        this.ensurePreviewWithinLimit(stat.size);

        const buffer = await runCancellableOperation(token, () => readFile(uri));
        if (buffer !== null) {
            this.ensurePreviewWithinLimit(buffer.byteLength);
        }
        return buffer;
    }

    private ensurePreviewWithinLimit(size: number): void {
        if (isImagePreviewWithinLimit(size)) {
            return;
        }

        throw new UserError(localize(
            'imagePreview.tooLarge',
            'Image preview is disabled for files larger than {0}. This file is {1}; open it with an external image tool or reduce the texture before previewing.',
            formatByteSize(maxCustomEditorImageBytes),
            formatByteSize(size),
        ));
    }

    protected abstract previewKind: string;
    protected abstract onOpen(): void;
    protected abstract getPng(buffer: Buffer): PNG;
}

export class DDSViewProvider extends CommonViewProvider {
    protected previewKind = 'dds';

    protected onOpen(): void {
        sendEvent('preview.dds');
    }

    protected override getEncodedImage(buffer: Buffer, signal: AbortSignal): Promise<EncodedImage> {
        return ddsToPngBufferAsync(DDS.parse(toArrayBuffer(buffer), 0), signal);
    }

    protected getPng(buffer: Buffer): PNG {
        const dds = DDS.parse(toArrayBuffer(buffer), 0);
        return ddsToPng(dds);
    }
}

export class TGAViewProvider extends CommonViewProvider {
    protected previewKind = 'tga';

    protected onOpen(): void {
        sendEvent('preview.tga');
    }

    protected getPng(buffer: Buffer): PNG {
        return tgaToPng(buffer);
    }
}
