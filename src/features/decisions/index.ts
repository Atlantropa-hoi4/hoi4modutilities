import { decisionPreviewDef } from '../../previewdef/decision';
import type { ExtensionFeature } from '../types';

export const decisionFeature: ExtensionFeature = {
    id: 'decisions',
    previewDescriptors: [decisionPreviewDef],
};
