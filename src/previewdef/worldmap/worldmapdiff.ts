import { isEqual } from 'lodash';

export interface WorldMapComparisonBudget {
    remaining: number;
}

const defaultWorldMapComparisonBudget = 25000;

export function createWorldMapComparisonBudget(limit: number = defaultWorldMapComparisonBudget): WorldMapComparisonBudget {
    return {
        remaining: Math.max(0, limit),
    };
}

export function areEqualWithinBudget(
    left: unknown,
    right: unknown,
    budget: WorldMapComparisonBudget,
): boolean | undefined {
    if (left === right) {
        return true;
    }

    if (left == null || right == null) {
        return false;
    }

    const leftType = typeof left;
    if (leftType !== typeof right) {
        return false;
    }

    if (leftType !== 'object') {
        return Object.is(left, right);
    }

    const leftIsArray = Array.isArray(left);
    const rightIsArray = Array.isArray(right);
    if (leftIsArray !== rightIsArray) {
        return false;
    }

    if (leftIsArray && rightIsArray) {
        if (left.length !== right.length) {
            return false;
        }
    } else {
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const leftKeys = Object.keys(leftRecord);
        const rightKeys = Object.keys(rightRecord);
        if (leftKeys.length !== rightKeys.length) {
            return false;
        }

        for (const key of leftKeys) {
            if (!(key in rightRecord)) {
                return false;
            }

            const leftValue = leftRecord[key];
            const rightValue = rightRecord[key];
            if (leftValue === rightValue) {
                continue;
            }

            if (leftValue == null || rightValue == null) {
                return false;
            }

            const nestedLeftIsArray = Array.isArray(leftValue);
            const nestedRightIsArray = Array.isArray(rightValue);
            if (nestedLeftIsArray !== nestedRightIsArray) {
                return false;
            }

            if (nestedLeftIsArray && nestedRightIsArray) {
                if (leftValue.length !== rightValue.length) {
                    return false;
                }
                continue;
            }

            const nestedLeftType = typeof leftValue;
            if (nestedLeftType !== typeof rightValue) {
                return false;
            }

            if (nestedLeftType !== 'object') {
                return false;
            }
        }
    }

    if (budget.remaining <= 0) {
        return undefined;
    }

    budget.remaining -= 1;
    return isEqual(left, right);
}
