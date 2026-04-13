import { guiPreviewDef } from '../../previewdef/gui';
import type { ExtensionFeature } from '../types';

export const guiFeature: ExtensionFeature = {
    id: 'gui',
    previewDescriptors: [guiPreviewDef],
};
