import { mioPreviewDef } from '../../previewdef/mio';
import type { ExtensionFeature } from '../types';

export const mioFeature: ExtensionFeature = {
    id: 'mio',
    previewDescriptors: [mioPreviewDef],
};
