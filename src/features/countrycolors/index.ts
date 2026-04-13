import { registerCountryColorProvider } from '../../util/countryColorProvider';
import type { ExtensionFeature } from '../types';

export const countryColorFeature: ExtensionFeature = {
    id: 'countrycolors',
    registrations: [
        {
            area: 'editor',
            register: () => registerCountryColorProvider(),
        },
    ],
};
