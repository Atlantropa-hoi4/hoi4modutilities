import { localize } from "../../util/i18n";
import type { Focus, FocusWarning } from "./schema";

type LintAggregate = {
    warningCount: number;
    infoCount: number;
    messages: string[];
};

export interface FocusLintResult {
    warnings: FocusWarning[];
    byFocusId: Record<string, LintAggregate>;
}

export function collectFocusLint(focuses: Record<string, Focus>, currentFilePath?: string): FocusLintResult {
    const warnings: FocusWarning[] = [];
    const focusList = Object.values(focuses);
    const missingPrerequisiteKeys = new Set<string>();
    const missingExclusiveKeys = new Set<string>();
    const asymmetricExclusivePairs = new Set<string>();

    for (const focus of focusList) {
        for (const group of focus.prerequisite) {
            for (const targetId of group) {
                if (focuses[targetId]) {
                    continue;
                }

                const key = `${focus.id}::${targetId}`;
                if (missingPrerequisiteKeys.has(key)) {
                    continue;
                }
                missingPrerequisiteKeys.add(key);
                warnings.push(createLintWarning({
                    code: 'missing-prerequisite-target',
                    source: focus.id,
                    text: localize(
                        'TODO',
                        'Focus {0} references missing prerequisite target {1}.',
                        focus.id,
                        targetId,
                    ),
                    relatedFocusIds: [focus.id],
                    navigations: buildFocusNavigations([focus]),
                }));
            }
        }

        for (const targetId of focus.exclusive) {
            if (focuses[targetId]) {
                const pairKey = [focus.id, targetId].sort().join('::');
                if (!focuses[targetId].exclusive.includes(focus.id) && !asymmetricExclusivePairs.has(pairKey)) {
                    asymmetricExclusivePairs.add(pairKey);
                    warnings.push(createLintWarning({
                        code: 'exclusive-asymmetric',
                        source: focus.id,
                        text: localize(
                            'TODO',
                            'Mutually exclusive link between {0} and {1} is not symmetric.',
                            focus.id,
                            targetId,
                        ),
                        relatedFocusIds: [focus.id, targetId],
                        navigations: buildFocusNavigations([focus, focuses[targetId]].filter((value): value is Focus => value !== undefined)),
                    }));
                }
                continue;
            }

            const key = `${focus.id}::${targetId}`;
            if (missingExclusiveKeys.has(key)) {
                continue;
            }
            missingExclusiveKeys.add(key);
            warnings.push(createLintWarning({
                code: 'missing-exclusive-target',
                source: focus.id,
                text: localize(
                    'TODO',
                    'Focus {0} references missing mutually exclusive target {1}.',
                    focus.id,
                    targetId,
                ),
                relatedFocusIds: [focus.id],
                navigations: buildFocusNavigations([focus]),
            }));
        }

        if (focus.relativePositionId && focuses[focus.relativePositionId]) {
            const matchesPrerequisite = focus.prerequisite.some(group => group.includes(focus.relativePositionId!));
            if (!matchesPrerequisite) {
                warnings.push(createLintWarning({
                    code: 'relative-position-prerequisite-mismatch',
                    source: focus.id,
                    text: localize(
                        'TODO',
                        'Focus {0} has relative_position_id {1} without matching prerequisite.',
                        focus.id,
                        focus.relativePositionId,
                    ),
                    relatedFocusIds: [focus.id, focus.relativePositionId],
                    navigations: buildFocusNavigations([focus, focuses[focus.relativePositionId]].filter((value): value is Focus => value !== undefined)),
                }));
            }
        }
    }

    const reachableFocusIds = collectReachableFocusIds(focuses, currentFilePath);
    for (const focus of focusList) {
        if (reachableFocusIds.has(focus.id)) {
            continue;
        }

        warnings.push(createLintWarning({
            code: 'focus-unreachable-candidate',
            severity: 'info',
            source: focus.id,
            text: localize(
                'TODO',
                'Focus {0} is a candidate unreachable focus in the current tree graph.',
                focus.id,
            ),
            relatedFocusIds: [focus.id],
            navigations: buildFocusNavigations([focus]),
        }));
    }

    return {
        warnings: sortFocusWarnings(warnings),
        byFocusId: aggregateLintByFocus(warnings),
    };
}

export function sortFocusWarnings(warnings: FocusWarning[]): FocusWarning[] {
    const kindOrder: Record<FocusWarning['kind'], number> = {
        lint: 0,
        parse: 1,
    };
    const severityOrder: Record<FocusWarning['severity'], number> = {
        warning: 0,
        info: 1,
    };

    return [...warnings].sort((a, b) =>
        (kindOrder[a.kind] - kindOrder[b.kind])
        || (severityOrder[a.severity] - severityOrder[b.severity])
        || a.source.localeCompare(b.source)
        || a.code.localeCompare(b.code)
        || a.text.localeCompare(b.text),
    );
}

function createLintWarning(params: {
    code: string;
    source: string;
    text: string;
    severity?: FocusWarning['severity'];
    relatedFocusIds?: string[];
    navigations?: FocusWarning['navigations'];
}): FocusWarning {
    return {
        code: params.code,
        severity: params.severity ?? 'warning',
        kind: 'lint',
        source: params.source,
        text: params.text,
        relatedFocusIds: params.relatedFocusIds,
        navigations: params.navigations,
    };
}

function buildFocusNavigations(focuses: Focus[]): FocusWarning['navigations'] {
    const navigations = focuses
        .filter(focus => !!focus.token)
        .map(focus => ({
            file: focus.file,
            start: focus.token?.start ?? 0,
            end: focus.token?.end ?? 0,
        }));

    return navigations.length > 0 ? navigations : undefined;
}

function aggregateLintByFocus(warnings: FocusWarning[]): Record<string, LintAggregate> {
    const result: Record<string, LintAggregate> = {};

    for (const warning of warnings) {
        if (warning.kind !== 'lint') {
            continue;
        }

        const focusIds = Array.from(new Set(
            (warning.relatedFocusIds && warning.relatedFocusIds.length > 0)
                ? warning.relatedFocusIds
                : [warning.source],
        ));

        for (const focusId of focusIds) {
            if (!result[focusId]) {
                result[focusId] = {
                    warningCount: 0,
                    infoCount: 0,
                    messages: [],
                };
            }

            if (warning.severity === 'warning') {
                result[focusId].warningCount += 1;
            } else {
                result[focusId].infoCount += 1;
            }

            if (!result[focusId].messages.includes(warning.text)) {
                result[focusId].messages.push(warning.text);
            }
        }
    }

    return result;
}

function collectReachableFocusIds(focuses: Record<string, Focus>, currentFilePath?: string): Set<string> {
    const reachable = new Set<string>();
    const queue: string[] = [];
    const childrenByParent: Record<string, string[]> = {};

    for (const focus of Object.values(focuses)) {
        if (focus.prerequisite.length === 0 || (currentFilePath ? focus.file !== currentFilePath : !focus.isInCurrentFile)) {
            reachable.add(focus.id);
            queue.push(focus.id);
        }

        for (const group of focus.prerequisite) {
            for (const parentId of group) {
                if (!focuses[parentId]) {
                    continue;
                }

                if (!childrenByParent[parentId]) {
                    childrenByParent[parentId] = [];
                }
                childrenByParent[parentId].push(focus.id);
            }
        }
    }

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        for (const childId of childrenByParent[currentId] ?? []) {
            if (reachable.has(childId)) {
                continue;
            }

            reachable.add(childId);
            queue.push(childId);
        }
    }

    return reachable;
}
