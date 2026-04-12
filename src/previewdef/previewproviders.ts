import { gfxPreviewDef } from './gfx';
import { eventPreviewDef } from './event';
import { guiPreviewDef } from './gui';
import { mioPreviewDef } from './mio';
import { focusTreePreviewDef } from './focustree';
import { technologyPreviewDef } from './technology';
import { worldMapPreviewDef } from './worldmap';
import { PreviewDescriptor } from './descriptor';

export const defaultPreviewProviders: PreviewDescriptor[] = [
    focusTreePreviewDef,
    gfxPreviewDef,
    technologyPreviewDef,
    worldMapPreviewDef,
    eventPreviewDef,
    guiPreviewDef,
    mioPreviewDef,
];
