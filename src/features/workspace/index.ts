import { registerHoiFs } from '../../util/hoifs';
import { registerModFile } from '../../util/modfile';
import type { ExtensionFeature } from '../types';

export const workspaceFeature: ExtensionFeature = {
    id: 'workspace',
    registrations: [
        {
            area: 'editor',
            register: () => [
                registerModFile(),
                registerHoiFs(),
            ],
        },
    ],
};
