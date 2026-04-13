import { registerLocalisationHighlighting } from '../../util/localisationHighlighting';
import { registerLocalisationIndex } from '../../util/localisationIndex';
import type { ExtensionFeature } from '../types';

export const localisationFeature: ExtensionFeature = {
    id: 'localisation',
    registrations: [
        {
            area: 'editor',
            register: () => registerLocalisationHighlighting(),
        },
        {
            area: 'index',
            register: () => registerLocalisationIndex(),
        },
    ],
};
