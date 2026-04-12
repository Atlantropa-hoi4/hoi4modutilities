import { flatten } from 'lodash';
import { Node } from "../../hoiformat/hoiparser";
import { ConditionItem, extractConditionValue, extractConditionValues, extractConditionalExprs } from "../../hoiformat/condition";
import { HOIPartial, Raw } from "../../hoiformat/schema";
import { countryScope } from "../../hoiformat/scope";
import { randomString } from "../../util/common";
import { useConditionInFocus } from "../../util/featureflags";
import { normalizeNumberLike } from "../../util/hoi4gui/common";
import { localize } from "../../util/i18n";
import { createFocusPositionEditKey } from "./positioneditcommon";
import { collectFocusLint, sortFocusWarnings } from "./focuslint";
import { parseInlayWindowRef } from "./inlay";
import { getJointFocusTreeId, parseFocusIcon } from "./focustreeschematypes";
import type { Focus, FocusDef, FocusFile, FocusTree, FocusTreeInlayRef, FocusWarning } from "./focustreeschematypes";

export function buildFocusTreesFromFile(
    file: HOIPartial<FocusFile>,
    sharedFocusTrees: FocusTree[],
    filePath: string,
    constants: {},
): FocusTree[] {
    const focusTrees: FocusTree[] = [];
    const linkedFocusTrees = [...sharedFocusTrees];

    if (file.shared_focus.length > 0) {
        const conditionExprs: ConditionItem[] = [];
        const parseWarnings: FocusWarning[] = [];
        const focuses = getFocuses(file.shared_focus, conditionExprs, filePath, parseWarnings, constants);
        validateRelativePositionId(focuses, parseWarnings);
        const warnings = finalizeFocusTreeWarnings(focuses, parseWarnings, filePath);

        const sharedFocusTree: FocusTree = {
            id: localize('focustree.sharedfocuses', '<Shared focuses>'),
            kind: 'shared',
            focuses,
            inlayWindowRefs: [],
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: getAllowBranchOptions(focuses),
            conditionExprs,
            isSharedFocues: true,
            warnings,
        };
        focusTrees.push(sharedFocusTree);
        linkedFocusTrees.unshift(sharedFocusTree);
    }

    if (file.joint_focus.length > 0) {
        const conditionExprs: ConditionItem[] = [];
        const parseWarnings: FocusWarning[] = [];
        const focuses = getFocuses(file.joint_focus, conditionExprs, filePath, parseWarnings, constants);
        validateRelativePositionId(focuses, parseWarnings);
        const warnings = finalizeFocusTreeWarnings(focuses, parseWarnings, filePath);

        const jointFocusTree: FocusTree = {
            id: getJointFocusTreeId(filePath),
            kind: 'joint',
            focuses,
            inlayWindowRefs: [],
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: getAllowBranchOptions(focuses),
            conditionExprs,
            isSharedFocues: false,
            warnings,
        };
        focusTrees.push(jointFocusTree);
        linkedFocusTrees.unshift(jointFocusTree);
    }

    for (const focusTree of file.focus_tree) {
        const conditionExprs: ConditionItem[] = [];
        const parseWarnings: FocusWarning[] = [];
        const focuses = getFocuses(focusTree.focus, conditionExprs, filePath, parseWarnings, constants);

        if (useConditionInFocus) {
            for (const sharedFocus of focusTree.shared_focus) {
                if (!sharedFocus) {
                    continue;
                }
                addSharedFocus(focuses, filePath, linkedFocusTrees, sharedFocus, conditionExprs, parseWarnings);
            }
        }

        validateRelativePositionId(focuses, parseWarnings);
        const warnings = finalizeFocusTreeWarnings(focuses, parseWarnings, filePath);

        focusTrees.push({
            id: focusTree.id ?? localize('focustree.ananymous', '<Anonymous focus tree>'),
            kind: 'focus',
            focuses,
            inlayWindowRefs: focusTree.inlay_window
                .map(v => v?._raw)
                .filter((v): v is Node => v !== undefined)
                .map(v => parseInlayWindowRef(v, filePath))
                .filter((v): v is FocusTreeInlayRef => v !== undefined),
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: getAllowBranchOptions(focuses),
            continuousFocusPositionX: focusTree.continuous_focus_position
                ? (normalizeNumberLike(focusTree.continuous_focus_position.x, 0) ?? 50)
                : undefined,
            continuousFocusPositionY: focusTree.continuous_focus_position
                ? (normalizeNumberLike(focusTree.continuous_focus_position.y, 0) ?? 1000)
                : undefined,
            conditionExprs,
            isSharedFocues: false,
            warnings,
        });
    }

    return focusTrees;
}

export function attachSharedFocusesToTree(
    focuses: Record<string, Focus>,
    filePath: string,
    sharedFocusTrees: FocusTree[],
    sharedFocusId: string,
    conditionExprs: ConditionItem[],
    warnings: FocusWarning[],
): void {
    addSharedFocus(focuses, filePath, sharedFocusTrees, sharedFocusId, conditionExprs, warnings);
}

export function createParseWarning(params: {
    code: string;
    text: string;
    source: string;
    relatedFocusIds?: string[];
    navigations?: FocusWarning['navigations'];
    severity?: FocusWarning['severity'];
}): FocusWarning {
    return {
        code: params.code,
        severity: params.severity ?? 'warning',
        kind: 'parse',
        text: params.text,
        source: params.source,
        relatedFocusIds: params.relatedFocusIds,
        navigations: params.navigations,
    };
}

function getFocuses(
    hoiFocuses: HOIPartial<FocusDef>[],
    conditionExprs: ConditionItem[],
    filePath: string,
    warnings: FocusWarning[],
    constants: {},
): Record<string, Focus> {
    const focuses: Record<string, Focus> = {};

    for (const hoiFocus of hoiFocuses) {
        const focus = getFocus(hoiFocus, conditionExprs, filePath, warnings, constants);
        if (focus === null) {
            continue;
        }

        if (focus.id in focuses) {
            const otherFocus = focuses[focus.id];
            warnings.push(createParseWarning({
                code: 'focus-duplicate-id',
                text: localize('focustree.warnings.focusidconflict', "There're more than one focuses with ID {0} in file: {1}.", focus.id, filePath),
                source: focus.id,
                relatedFocusIds: [focus.id],
                navigations: [
                    {
                        file: filePath,
                        start: focus.token?.start ?? 0,
                        end: focus.token?.end ?? 0,
                    },
                    {
                        file: filePath,
                        start: otherFocus.token?.start ?? 0,
                        end: otherFocus.token?.end ?? 0,
                    },
                ],
            }));
        }
        focuses[focus.id] = focus;
    }

    let hasChangedInAllowBranch = true;
    while (hasChangedInAllowBranch) {
        hasChangedInAllowBranch = false;
        for (const key in focuses) {
            const focus = focuses[key];
            const allPrerequisites = flatten(focus.prerequisite).filter(p => p in focuses);
            if (allPrerequisites.length === 0) {
                continue;
            }

            for (const allowBranchId of allPrerequisites.flatMap(p => focuses[p].inAllowBranch)) {
                if (!focus.inAllowBranch.includes(allowBranchId)) {
                    focus.inAllowBranch.push(allowBranchId);
                    hasChangedInAllowBranch = true;
                }
            }
        }
    }

    return focuses;
}

function finalizeFocusTreeWarnings(
    focuses: Record<string, Focus>,
    parseWarnings: FocusWarning[],
    currentFilePath: string,
): FocusWarning[] {
    const lintResult = collectFocusLint(focuses, currentFilePath);
    for (const focus of Object.values(focuses)) {
        const lintAggregate = lintResult.byFocusId[focus.id];
        focus.lintWarningCount = lintAggregate?.warningCount ?? 0;
        focus.lintInfoCount = lintAggregate?.infoCount ?? 0;
        focus.lintMessages = lintAggregate?.messages;
    }

    return sortFocusWarnings(parseWarnings.concat(lintResult.warnings));
}

function getFocus(
    hoiFocus: HOIPartial<FocusDef>,
    conditionExprs: ConditionItem[],
    filePath: string,
    warnings: FocusWarning[],
    constants: {},
): Focus | null {
    const id = hoiFocus.id ?? `[missing_id_${randomString(8)}]`;

    if (!hoiFocus.id) {
        warnings.push(createParseWarning({
            code: 'focus-missing-id',
            text: localize('focustree.warnings.focusnoid', "A focus defined in this file don't have ID: {0}.", filePath),
            source: id,
        }));
    }

    const exclusive = hoiFocus.mutually_exclusive
        .flatMap(f => f.focus.concat(f.OR))
        .filter((s): s is string => s !== undefined);
    const prerequisite = hoiFocus.prerequisite
        .map(p => p.focus.concat(p.OR).filter((s): s is string => s !== undefined));
    const available = hoiFocus.available
        ? extractConditionValue(hoiFocus.available._raw.value, countryScope, []).condition
        : undefined;
    const icon = parseFocusIcon(hoiFocus.icon.filter((v): v is Raw => v !== undefined).map(v => v._raw), constants);
    const hasAllowBranch = hoiFocus.allow_branch.length > 0;
    const allowBranchCondition = extractConditionValues(
        hoiFocus.allow_branch.filter((v): v is Raw => v !== undefined).map(v => v._raw.value),
        countryScope,
        conditionExprs,
    ).condition;
    const offset = hoiFocus.offset.map(o => ({
        x: o.x ?? 0,
        y: o.y ?? 0,
        trigger: o.trigger && o.trigger.length > 0
            ? extractConditionValues(o.trigger.filter((v): v is Raw => v !== undefined).map(v => v._raw.value), countryScope, []).condition
            : undefined,
    }));

    return {
        layoutEditKey: createFocusPositionEditKey(filePath, hoiFocus._token?.start ?? id),
        id,
        icon,
        available,
        availableIfCapitulated: hoiFocus.available_if_capitulated === true,
        hasAiWillDo: hoiFocus.ai_will_do !== undefined,
        hasCompletionReward: hoiFocus.completion_reward !== undefined,
        x: hoiFocus.x ?? 0,
        y: hoiFocus.y ?? 0,
        relativePositionId: hoiFocus.relative_position_id,
        prerequisite,
        prerequisiteGroupCount: prerequisite.length,
        prerequisiteFocusCount: prerequisite.reduce((sum, group) => sum + group.length, 0),
        exclusive,
        exclusiveCount: exclusive.length,
        hasAllowBranch,
        inAllowBranch: hasAllowBranch ? [id] : [],
        allowBranch: allowBranchCondition,
        offset,
        token: hoiFocus._token,
        file: filePath,
        isInCurrentFile: true,
        text: hoiFocus.text,
        lintWarningCount: 0,
        lintInfoCount: 0,
    };
}

function addSharedFocus(
    focuses: Record<string, Focus>,
    filePath: string,
    sharedFocusTrees: FocusTree[],
    sharedFocusId: string,
    conditionExprs: ConditionItem[],
    warnings: FocusWarning[],
) {
    const sharedFocusTree = sharedFocusTrees.find(sft => sharedFocusId in sft.focuses);
    if (!sharedFocusTree) {
        return;
    }

    const sharedFocuses = sharedFocusTree.focuses;

    focuses[sharedFocusId] = sharedFocuses[sharedFocusId];
    updateConditionExprsByFocus(sharedFocuses[sharedFocusId], conditionExprs);

    let hasChanged = true;
    while (hasChanged) {
        hasChanged = false;
        for (const key in sharedFocuses) {
            if (key in focuses) {
                continue;
            }

            const focus = sharedFocuses[key];
            const allPrerequisites = flatten(focus.prerequisite).filter(p => p in sharedFocuses);
            if (allPrerequisites.length === 0) {
                continue;
            }

            if (!allPrerequisites.every(p => p in focuses)) {
                continue;
            }

            if (focus.id in focuses) {
                const otherFocus = focuses[focus.id];
                warnings.push(createParseWarning({
                    code: 'focus-duplicate-id',
                    text: localize('focustree.warnings.focusidconflict2', "There're more than one focuses with ID {0} in files: {1}, {2}.", focus.id, filePath, focus.file),
                    source: focus.id,
                    relatedFocusIds: [focus.id],
                    navigations: [
                        {
                            file: focus.file,
                            start: focus.token?.start ?? 0,
                            end: focus.token?.end ?? 0,
                        },
                        {
                            file: filePath,
                            start: otherFocus.token?.start ?? 0,
                            end: otherFocus.token?.end ?? 0,
                        },
                    ],
                }));
            }
            focuses[key] = focus;
            updateConditionExprsByFocus(focus, conditionExprs);
            hasChanged = true;
        }
    }

    for (const warning of sharedFocusTree.warnings) {
        if (warning.kind === 'parse' && warning.source in focuses) {
            warnings.push(warning);
        }
    }
}

function updateConditionExprsByFocus(focus: Focus, conditionExprs: ConditionItem[]) {
    if (focus.allowBranch) {
        extractConditionalExprs(focus.allowBranch, conditionExprs);
    }
}

function getAllowBranchOptions(focuses: Record<string, Focus>): string[] {
    return Array.from(new Set(
        Object.values(focuses)
            .filter(f => f.hasAllowBranch && f.allowBranch !== true)
            .map(f => f.id),
    ));
}

function validateRelativePositionId(focuses: Record<string, Focus>, warnings: FocusWarning[]) {
    const relativePositionId: Record<string, Focus | undefined> = {};
    const relativePositionIdChain: string[] = [];
    const circularReported: Record<string, boolean> = {};

    for (const focus of Object.values(focuses)) {
        if (focus.relativePositionId === undefined) {
            continue;
        }

        if (!(focus.relativePositionId in focuses)) {
            warnings.push(createParseWarning({
                code: 'relative-position-target-missing',
                text: localize('focustree.warnings.relativepositionidnotexist', 'Relative position ID of focus {0} not exist: {1}.', focus.id, focus.relativePositionId),
                source: focus.id,
                relatedFocusIds: [focus.id],
                navigations: focus.token ? [{
                    file: focus.file,
                    start: focus.token.start,
                    end: focus.token.end,
                }] : undefined,
            }));
            continue;
        }

        relativePositionIdChain.length = 0;
        relativePositionId[focus.id] = focuses[focus.relativePositionId];
        let currentFocus: Focus | undefined = focus;
        while (currentFocus) {
            if (circularReported[currentFocus.id]) {
                break;
            }

            relativePositionIdChain.push(currentFocus.id);
            const nextFocus: Focus | undefined = relativePositionId[currentFocus.id];
            if (nextFocus && relativePositionIdChain.includes(nextFocus.id)) {
                relativePositionIdChain.forEach(r => {
                    circularReported[r] = true;
                });
                relativePositionIdChain.push(nextFocus.id);
                const navigationTargets = relativePositionIdChain
                    .map(focusId => focuses[focusId])
                    .filter((value): value is Focus => value !== undefined && !!value.token)
                    .map(focusEntry => ({
                        file: focusEntry.file,
                        start: focusEntry.token!.start,
                        end: focusEntry.token!.end,
                    }));
                warnings.push(createParseWarning({
                    code: 'relative-position-circular',
                    text: localize('focustree.warnings.relativepositioncircularref', "There're circular reference in relative position ID of these focuses: {0}.", relativePositionIdChain.join(' -> ')),
                    source: focus.id,
                    relatedFocusIds: Array.from(new Set(relativePositionIdChain)),
                    navigations: navigationTargets.length > 0 ? navigationTargets : undefined,
                }));
                break;
            }
            currentFocus = nextFocus;
        }
    }
}
