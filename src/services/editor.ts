import { ExtensionServices } from './serviceRegistry';
import { registerFeatureArea } from '../features/catalog';

export function registerEditorServices(services: ExtensionServices): void {
    services.push(...registerFeatureArea('editor'));
}
