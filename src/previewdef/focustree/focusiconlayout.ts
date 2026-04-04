export interface FocusIconDisplaySize {
    width: number;
    height: number;
}

export function fitFocusIconToBounds(
    iconWidth: number,
    iconHeight: number,
    maxWidth: number,
    maxHeight: number,
): FocusIconDisplaySize {
    const safeMaxWidth = Math.max(0, maxWidth);
    const safeMaxHeight = Math.max(0, maxHeight);
    if (safeMaxWidth === 0 || safeMaxHeight === 0 || iconWidth <= 0 || iconHeight <= 0) {
        return { width: 0, height: 0 };
    }

    const scale = Math.min(1, safeMaxWidth / iconWidth, safeMaxHeight / iconHeight);
    return {
        width: Math.max(1, Math.round(iconWidth * scale)),
        height: Math.max(1, Math.round(iconHeight * scale)),
    };
}
