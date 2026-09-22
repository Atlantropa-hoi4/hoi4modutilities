import { ConditionItem, applyCondition } from "../../hoiformat/condition";
import { NumberPosition } from "../../util/common";
import { FocusTreeView as FocusTree, FocusView as Focus } from './viewmodel';

export function getFocusPosition(
    focus: Focus | undefined,
    positionByFocusId: Record<string, NumberPosition>,
    focusTree: FocusTree,
    exprs: ConditionItem[],
    focusStack: Focus[] = [],
): NumberPosition {
    if (focus === undefined) {
        return { x: 0, y: 0 };
    }

    const cached = positionByFocusId[focus.id];
    if (cached) {
        return cached;
    }

    if (focus.relativePositionId === undefined && focusStack.length === 0) {
        const activeOffset = getActiveFocusOffset(focus, exprs);
        const position = { x: focus.x + activeOffset.x, y: focus.y + activeOffset.y };
        positionByFocusId[focus.id] = position;
        return position;
    }

    const visited = new Set(focusStack);
    const unresolved: Focus[] = [];
    let current: Focus | undefined = focus;
    let position: NumberPosition = { x: 0, y: 0 };
    while (current) {
        const currentPosition = positionByFocusId[current.id];
        if (currentPosition) {
            position = currentPosition;
            break;
        }
        if (visited.has(current)) {
            break;
        }
        visited.add(current);
        unresolved.push(current);
        current = current.relativePositionId !== undefined
            ? focusTree.focuses[current.relativePositionId]
            : undefined;
    }

    // Resolve from the anchor back to the requested focus without recursive calls.
    // A missing anchor or a cycle keeps the same zero-origin fallback as before.
    for (let index = unresolved.length - 1; index >= 0; index -= 1) {
        const unresolvedFocus = unresolved[index];
        const activeOffset = getActiveFocusOffset(unresolvedFocus, exprs);
        position = {
            x: unresolvedFocus.x + position.x + activeOffset.x,
            y: unresolvedFocus.y + position.y + activeOffset.y,
        };
        positionByFocusId[unresolvedFocus.id] = position;
    }
    return position;
}

export function getActiveFocusOffset(focus: Focus, exprs: ConditionItem[]): NumberPosition {
    let x = 0;
    let y = 0;

    for (const offset of focus.offset) {
        if (offset.trigger === undefined || applyCondition(offset.trigger, exprs)) {
            x += offset.x;
            y += offset.y;
        }
    }

    return { x, y };
}

export function getLocalPositionFromRenderedAbsolute(
    focus: Focus,
    focusTree: FocusTree,
    exprs: ConditionItem[],
    renderedAbsolutePosition: NumberPosition,
): NumberPosition {
    const relativeBasePosition = focus.relativePositionId
        ? getFocusPosition(focusTree.focuses[focus.relativePositionId], {}, focusTree, exprs)
        : { x: 0, y: 0 };
    const activeOffset = getActiveFocusOffset(focus, exprs);

    return {
        x: Math.round(renderedAbsolutePosition.x - relativeBasePosition.x - activeOffset.x),
        y: Math.round(renderedAbsolutePosition.y - relativeBasePosition.y - activeOffset.y),
    };
}
