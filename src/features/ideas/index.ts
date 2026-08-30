import { ideaPreviewDef } from '../../previewdef/idea';
import { registerIdeaSwapIndex } from '../../util/ideaSwapIndex';
import type { ExtensionFeature } from '../types';

export const ideaFeature: ExtensionFeature = {
    id: 'ideas',
    previewDescriptors: [ideaPreviewDef],
    registrations: [{ area: 'index', register: () => registerIdeaSwapIndex() }],
};

