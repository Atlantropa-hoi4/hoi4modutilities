import { ExtensionServices } from './serviceRegistry';
import { registerFeatureArea } from '../features/catalog';

export function registerIndexServices(services: ExtensionServices): void {
    services.push(...registerFeatureArea('index'));
}
