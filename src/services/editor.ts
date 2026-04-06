import { registerCountryColorProvider } from '../util/countryColorProvider';
import { registerHoiFs } from '../util/hoifs';
import { registerLocalisationHighlighting } from '../util/localisationHighlighting';
import { registerModFile } from '../util/modfile';
import { registerScanReferencesCommand } from '../util/dependency';
import { ExtensionServices } from './serviceRegistry';

export function registerEditorServices(services: ExtensionServices): void {
    services.push(
        registerModFile(),
        registerScanReferencesCommand(),
        registerHoiFs(),
        registerLocalisationHighlighting(),
        registerCountryColorProvider(),
    );
}
