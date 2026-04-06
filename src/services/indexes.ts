import { registerGfxIndex } from '../util/gfxindex';
import { registerLocalisationIndex } from '../util/localisationIndex';
import { registerSharedFocusIndex } from '../util/sharedFocusIndex';
import { ExtensionServices } from './serviceRegistry';

export function registerIndexServices(services: ExtensionServices): void {
    services.push(
        registerSharedFocusIndex(),
        registerGfxIndex(),
        registerLocalisationIndex(),
    );
}
