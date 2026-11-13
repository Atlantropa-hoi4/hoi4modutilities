import { guiPreviewDef } from '../../previewdef/gui';
import { registerGuiIndex } from '../../util/guiIndex';
import type { ExtensionFeature } from '../types';

export const guiFeature: ExtensionFeature = {
    id: 'gui',
    previewDescriptors: [guiPreviewDef],
    registrations: [{ area: 'index', register: registerGuiIndex }],
};
