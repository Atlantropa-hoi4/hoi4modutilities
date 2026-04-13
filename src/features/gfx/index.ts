import { gfxPreviewDef } from '../../previewdef/gfx';
import { registerGfxIndex } from '../../util/gfxindex';
import type { ExtensionFeature } from '../types';

export const gfxFeature: ExtensionFeature = {
    id: 'gfx',
    previewDescriptors: [gfxPreviewDef],
    registrations: [
        {
            area: 'index',
            register: () => registerGfxIndex(),
        },
    ],
};
