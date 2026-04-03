import { NumberPosition } from "../../util/common";
import { FocusLayoutDraft, FocusLayoutOffsetDraft } from "./layouteditcommon";

export type LayoutTargetKind = 'focus' | 'continuous' | 'inlayRef' | 'offset';

export interface LayoutTargetDescriptor {
    key: string;
    kind: LayoutTargetKind;
    label: string;
    editable: boolean;
    sourceFile: string;
    sourceStart?: number;
    sourceEnd?: number;
    currentPosition: NumberPosition;
    focusId?: string;
}

interface DragCalculationOptions {
    scale: number;
    xGridSize: number;
    yGridSize: number;
}

export function calculateDraggedLayoutPosition(
    target: Pick<LayoutTargetDescriptor, 'kind' | 'currentPosition'>,
    deltaPageX: number,
    deltaPageY: number,
    options: DragCalculationOptions,
): NumberPosition {
    const scale = options.scale || 1;
    const deltaX = deltaPageX / scale;
    const deltaY = deltaPageY / scale;

    if (target.kind === 'focus' || target.kind === 'offset') {
        return {
            x: Math.round(target.currentPosition.x + deltaX / options.xGridSize),
            y: Math.round(target.currentPosition.y + deltaY / options.yGridSize),
        };
    }

    return {
        x: Math.round(target.currentPosition.x + deltaX),
        y: Math.round(target.currentPosition.y + deltaY),
    };
}

export function findOffsetDraftByKey(
    draft: FocusLayoutDraft,
    offsetKey: string,
): { focusEditKey: string; offsetDraft: FocusLayoutOffsetDraft } | undefined {
    for (const [focusEditKey, focusDraft] of Object.entries(draft.focuses)) {
        const offsetDraft = focusDraft.offsets.find(offset => offset.editKey === offsetKey);
        if (offsetDraft) {
            return { focusEditKey, offsetDraft };
        }
    }

    return undefined;
}

export function applyDraggedLayoutPosition(
    draft: FocusLayoutDraft,
    target: Pick<LayoutTargetDescriptor, 'key' | 'kind'>,
    nextPosition: NumberPosition,
): boolean {
    switch (target.kind) {
        case 'focus': {
            const focusDraft = draft.focuses[target.key];
            if (!focusDraft) {
                return false;
            }

            const changed = focusDraft.x !== nextPosition.x || focusDraft.y !== nextPosition.y;
            focusDraft.x = nextPosition.x;
            focusDraft.y = nextPosition.y;
            return changed;
        }
        case 'continuous': {
            const pointDraft = draft.continuous[target.key];
            if (!pointDraft) {
                return false;
            }

            const changed = pointDraft.x !== nextPosition.x || pointDraft.y !== nextPosition.y;
            pointDraft.x = nextPosition.x;
            pointDraft.y = nextPosition.y;
            return changed;
        }
        case 'inlayRef': {
            const pointDraft = draft.inlayRefs[target.key];
            if (!pointDraft) {
                return false;
            }

            const changed = pointDraft.x !== nextPosition.x || pointDraft.y !== nextPosition.y;
            pointDraft.x = nextPosition.x;
            pointDraft.y = nextPosition.y;
            return changed;
        }
        case 'offset': {
            const resolved = findOffsetDraftByKey(draft, target.key);
            if (!resolved) {
                return false;
            }

            const { offsetDraft } = resolved;
            const changed = offsetDraft.x !== nextPosition.x || offsetDraft.y !== nextPosition.y;
            offsetDraft.x = nextPosition.x;
            offsetDraft.y = nextPosition.y;
            return changed;
        }
        default:
            return false;
    }
}
