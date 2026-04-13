import { worldMap, worldMapPreviewDef } from '../../previewdef/worldmap';
import type { ExtensionFeature } from '../types';

export const worldMapFeature: ExtensionFeature = {
    id: 'worldmap',
    previewDescriptors: [worldMapPreviewDef],
    registrations: [
        {
            area: 'preview',
            register: () => worldMap.register(),
        },
    ],
};
