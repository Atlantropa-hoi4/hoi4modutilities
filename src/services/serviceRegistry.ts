import * as vscode from 'vscode';
import { localizer, Localizer } from './localizer';

export interface ExtensionServices {
    context: vscode.ExtensionContext;
    localizer: Localizer;
    push(...disposables: vscode.Disposable[]): void;
}

class ExtensionServiceRegistry implements ExtensionServices, vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        public readonly context: vscode.ExtensionContext,
        public readonly localizer: Localizer,
    ) {}

    public push(...disposables: vscode.Disposable[]): void {
        this.disposables.push(...disposables);
    }

    public dispose(): void {
        vscode.Disposable.from(...this.disposables).dispose();
    }
}

export function createExtensionServices(context: vscode.ExtensionContext): ExtensionServices & vscode.Disposable {
    return new ExtensionServiceRegistry(context, localizer);
}
