import { registerHoi4LintProvider } from '../../util/hoi4LintProvider';
import type { ExtensionFeature } from '../types';

export const lintFeature: ExtensionFeature = {
    id: 'lint',
    registrations: [
        {
            area: 'editor',
            register: () => registerHoi4LintProvider(),
        },
    ],
};
