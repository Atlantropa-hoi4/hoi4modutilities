import { localizer } from '../services/localizer';

export function loadI18n(): void {
    // Localization is now sourced from vscode.l10n bundles.
}

export function localize(key: string, message: string, ...args: unknown[]): string {
    return localizer.legacy(key, message, ...args);
}

export function localizeText(text: string): string {
    return localizer.localizeText(text);
}

export function i18nTableAsScript(): string {
    return localizer.toWebviewScript();
}
