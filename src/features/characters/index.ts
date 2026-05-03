import { characterPreviewDef } from '../../previewdef/characters';
import type { ExtensionFeature } from '../types';

export const characterFeature: ExtensionFeature = {
    id: 'characters',
    previewDescriptors: [characterPreviewDef],
};
