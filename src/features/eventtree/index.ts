import { eventPreviewDef } from '../../previewdef/event';
import type { ExtensionFeature } from '../types';
import { registerEventIndex } from '../../util/eventIndex';

export const eventTreeFeature: ExtensionFeature = {
    id: 'eventtree',
    previewDescriptors: [eventPreviewDef],
    registrations: [{ area: 'index', register: registerEventIndex }],
};
