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

export function isLocalisationIndexEnabled(featureFlags: readonly string[] = getFeatureFlags()): boolean {
    return !featureFlags.includes('!localisationIndex');
}

export function isRightButtonDragEnabled(): boolean {
    return !hasFeatureFlag('!rightButtonDrag');
}

export function isTechnologyShowIdEnabled(): boolean {
    return hasFeatureFlag('technologyShowId');
}

export function isIdeaPreviewEnabled(): boolean {
    return !hasFeatureFlag('!ideaPreview');
}

export function isDecisionPreviewEnabled(): boolean {
    return !hasFeatureFlag('!decisionPreview');
}

export function isIdeaSwapIndexEnabled(): boolean {
    return hasFeatureFlag('ideaSwapIndex');
}

export function featureFlagsAsScript(): string {
    const featureFlagState = {
        useConditionInFocus: isUseConditionInFocusEnabled(),
        eventTreePreview: isEventTreePreviewEnabled(),
        sharedFocusIndex: isSharedFocusIndexEnabled(),
        gfxIndex: isGfxIndexEnabled(),
        localisationIndex: isLocalisationIndexEnabled(),
        rightButtonDrag: isRightButtonDragEnabled(),
        technologyShowId: isTechnologyShowIdEnabled(),
        ideaPreview: isIdeaPreviewEnabled(),
        decisionPreview: isDecisionPreviewEnabled(),
        ideaSwapIndex: isIdeaSwapIndexEnabled(),
    };
    return 'window.__featureflags = ' + JSON.stringify(featureFlagState) + ';';
}
