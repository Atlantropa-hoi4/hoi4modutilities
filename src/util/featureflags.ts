import { getConfiguration } from './vsccommon';

export function getFeatureFlags(): readonly string[] {
    return getConfiguration().featureFlags ?? [];
}

function hasFeatureFlag(flag: string): boolean {
    return getFeatureFlags().includes(flag);
}

export function isUseConditionInFocusEnabled(): boolean {
    return !hasFeatureFlag('!useConditionInFocus');
}

export function isEventTreePreviewEnabled(): boolean {
    return !hasFeatureFlag('!eventTreePreview');
}

export function isSharedFocusIndexEnabled(): boolean {
    return !hasFeatureFlag('!sharedFocusIndex');
}

export function isGfxIndexEnabled(): boolean {
    return !hasFeatureFlag('!gfxIndex');
}

export function isLocalisationIndexEnabled(): boolean {
    return !hasFeatureFlag('!localisationIndex');
}

export function isTechnologyShowIdEnabled(): boolean {
    return hasFeatureFlag('technologyShowId');
}
