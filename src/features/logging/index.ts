import { registerUpdateWorkspaceLogging } from '../../util/updateWorkspaceLogging';
import type { ExtensionFeature } from '../types';

export const loggingFeature: ExtensionFeature = {
    id: 'logging',
    registrations: [
        {
            area: 'editor',
            register: registerUpdateWorkspaceLogging,
        },
    ],
};
