export interface FocusHydrationRect {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface FocusHydrationViewport {
    width: number;
    height: number;
}

export interface FocusHydrationDecisionInput {
    alreadyHydrated: boolean;
    isSelected: boolean;
    rect: FocusHydrationRect;
    viewport: FocusHydrationViewport;
    margin?: number;
}

export function shouldHydrateFocus(input: FocusHydrationDecisionInput): boolean {
    if (input.alreadyHydrated) {
        return false;
    }

    if (input.isSelected) {
        return true;
    }

    const margin = input.margin ?? 320;
    return input.rect.bottom >= -margin
        && input.rect.right >= -margin
        && input.rect.top <= input.viewport.height + margin
        && input.rect.left <= input.viewport.width + margin;
}
