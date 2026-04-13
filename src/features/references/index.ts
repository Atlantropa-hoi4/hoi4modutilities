import { registerScanReferencesCommand } from '../../util/dependency';
import type { ExtensionFeature } from '../types';

export const referencesFeature: ExtensionFeature = {
    id: 'references',
    registrations: [
        {
            area: 'editor',
            register: () => registerScanReferencesCommand(),
        },
    ],
};
