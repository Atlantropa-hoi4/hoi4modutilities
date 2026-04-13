import { focusTreePreviewDef } from '../../previewdef/focustree';
import { registerGenerateFocusGfxShineCommand } from '../../util/focusGfxShine';
import { registerSharedFocusIndex } from '../../util/sharedFocusIndex';
import type { ExtensionFeature } from '../types';

export const focusTreeFeature: ExtensionFeature = {
    id: 'focustree',
    previewDescriptors: [focusTreePreviewDef],
    registrations: [
        {
            area: 'editor',
            register: () => registerGenerateFocusGfxShineCommand(),
        },
        {
            area: 'index',
            register: () => registerSharedFocusIndex(),
        },
    ],
};
