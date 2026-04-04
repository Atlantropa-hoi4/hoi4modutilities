import * as vscode from 'vscode';
import { findRegexPreviewPriority, previewDetectionMaxChars } from './previewdetectshared';

export { findRegexPreviewPriority, previewDetectionMaxChars, samplePreviewText } from './previewdetectshared';

export function getDocumentPreviewSample(
    document: vscode.TextDocument,
    maxChars: number = previewDetectionMaxChars,
): string {
    const end = document.positionAt(maxChars);
    return document.getText(new vscode.Range(new vscode.Position(0, 0), end));
}

export function findDocumentRegexPreviewPriority(
    document: vscode.TextDocument,
    pattern: RegExp,
    maxChars: number = previewDetectionMaxChars,
): number | undefined {
    return findRegexPreviewPriority(getDocumentPreviewSample(document, maxChars), pattern);
}

export function documentSampleContainsAny(
    document: vscode.TextDocument,
    keywords: readonly string[],
    maxChars: number = previewDetectionMaxChars,
): boolean {
    const lowerSample = getDocumentPreviewSample(document, maxChars).toLowerCase();
    return keywords.some(keyword => lowerSample.includes(keyword.toLowerCase()));
}
