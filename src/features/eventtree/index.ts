import { eventPreviewDef } from '../../previewdef/event';
import type { ExtensionFeature } from '../types';

export const eventTreeFeature: ExtensionFeature = {
    id: 'eventtree',
    previewDescriptors: [eventPreviewDef],
};
