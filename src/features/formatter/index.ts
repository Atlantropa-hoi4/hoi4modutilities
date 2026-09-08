import { registerHoi4FormatterProvider } from '../../util/hoi4FormatterProvider';
import { registerFormatWorkspace } from '../../util/formatWorkspace';
import type { ExtensionFeature } from '../types';

export const formatterFeature: ExtensionFeature = {
    id: 'formatter',
    registrations: [
        {
            area: 'editor',
            register: () => [...registerHoi4FormatterProvider(), registerFormatWorkspace()],
        },
    ],
};
