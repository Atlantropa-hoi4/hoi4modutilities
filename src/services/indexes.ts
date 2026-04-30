import { ExtensionServices } from './serviceRegistry';
import { registerFeatureArea } from '../features/catalog';
import { registerIndexPrewarm } from '../util/indexprewarm';

export function registerIndexServices(services: ExtensionServices): void {
    services.push(
        ...registerFeatureArea('index'),
        registerIndexPrewarm(),
    );
}
