import { registerTelemetryReporter, sendEvent } from '../util/telemetry';
import { ExtensionServices } from './serviceRegistry';

export function registerTelemetryServices(services: ExtensionServices): void {
    services.push(registerTelemetryReporter());
    sendEvent('extension.activate', { locale: 'vscode-l10n', runtime: 'desktop' });
}
