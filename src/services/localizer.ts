import * as vscode from 'vscode';

export class Localizer {
    public t(message: string, ...args: unknown[]): string {
        const normalizedArgs = args.map(arg => normalizeArg(arg));
        if (vscode.l10n?.t) {
            return vscode.l10n.t(message, ...normalizedArgs);
        }

        return formatMessage(message, normalizedArgs);
    }

    public legacy(_key: string, message: string, ...args: unknown[]): string {
        return this.t(message, ...args);
    }

    public localizeText(text: string): string {
        return text.replace(/%(.*?)(?:\|(.*?))?%/g, (substr, key, message) => {
            if (substr === '%%') {
                return '%';
            }

            if (!key) {
                return substr;
            }

            return this.legacy(key, message || key);
        });
    }

    public getBundle(): Record<string, string> {
        return { ...(vscode.l10n?.bundle ?? {}) };
    }

    public toWebviewScript(): string {
        return 'window.__i18ntable = ' + JSON.stringify(this.getBundle()) + ';';
    }
}

export const localizer = new Localizer();

function normalizeArg(arg: unknown): string | number | boolean {
    if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
        return arg;
    }

    if (Array.isArray(arg)) {
        return arg.join(', ');
    }

    if (arg === null || arg === undefined) {
        return '';
    }

    return String(arg);
}

function formatMessage(message: string, args: Array<string | number | boolean>): string {
    const regex = new RegExp('\\{(' + args.map((_, i) => i.toString()).join('|') + ')\\}', 'g');
    return message.replace(regex, (_, group1) => args[parseInt(group1, 10)]?.toString() ?? '');
}
