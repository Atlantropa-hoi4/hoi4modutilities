import { ExtensionServices } from './serviceRegistry';
import { registerFeatureArea } from '../features/catalog';
import { registerIndexPrewarm } from '../util/indexprewarm';
import { registerIndexSerialization } from './indexSerialization';
import { registerIndexServiceLifecycle } from './indexService';

export function registerIndexServices(services: ExtensionServices): void {
    services.push(
        registerIndexSerialization(services.context.extensionPath),
        registerIndexServiceLifecycle(),
        ...registerFeatureArea('index'),
        registerIndexPrewarm(),
    );
}
