import { ConditionItem, applyCondition } from "../../hoiformat/condition";
import { NumberPosition } from "../../util/common";
import { Focus, FocusTree } from "./schema";

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

    if (focusStack.includes(focus)) {
        return { x: 0, y: 0 };
    }

    let position: NumberPosition = { x: focus.x, y: focus.y };
    if (focus.relativePositionId !== undefined) {
        focusStack.push(focus);
        const relativeFocusPosition = getFocusPosition(
            focusTree.focuses[focus.relativePositionId],
            positionByFocusId,
            focusTree,
            exprs,
            focusStack,
        );
        focusStack.pop();
        position.x += relativeFocusPosition.x;
        position.y += relativeFocusPosition.y;
    }

    const activeOffset = getActiveFocusOffset(focus, exprs);
    position.x += activeOffset.x;
    position.y += activeOffset.y;

    positionByFocusId[focus.id] = position;
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
