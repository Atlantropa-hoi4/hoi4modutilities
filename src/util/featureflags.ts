import { getConfiguration } from "./vsccommon";

function getFeatureFlags() {
    return getConfiguration().featureFlags ?? [];
}

const featureFlags = getFeatureFlags();

export const useConditionInFocus = !featureFlags.includes('!useConditionInFocus');
export const eventTreePreview = !featureFlags.includes('!eventTreePreview');
export const sharedFocusIndex = !featureFlags.includes('!sharedFocusIndex');
export const gfxIndex = featureFlags.includes('gfxIndex');
export const localisationIndex = featureFlags.includes('localisationIndex');
