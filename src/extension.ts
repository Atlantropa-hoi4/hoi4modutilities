import * as vscode from 'vscode';
import { registerContextContainer, setVscodeContext } from './context';
import { ContextName } from './constants';
import { registerCommandServices } from './services/commands';
import { registerEditorServices } from './services/editor';
import { registerIndexServices } from './services/indexes';
import { registerPreviewServices } from './services/previews';
import { createExtensionServices } from './services/serviceRegistry';
import { registerTelemetryServices } from './services/telemetry';

export function activate(context: vscode.ExtensionContext) {
    const services = createExtensionServices(context);

    // Must register this first because other components may use it.
    services.push(registerContextContainer(context));

    registerTelemetryServices(services);
    registerPreviewServices(services);
    registerEditorServices(services);
    registerIndexServices(services);
    registerCommandServices(services);

    context.subscriptions.push(services);
    setVscodeContext(ContextName.Hoi4MULoaded, true);
}

export function deactivate() {}
