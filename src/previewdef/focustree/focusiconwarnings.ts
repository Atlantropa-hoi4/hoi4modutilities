import { localize } from "../../util/i18n";
import { sortFocusWarnings } from "./focuslint";
import type { FocusTree, FocusWarning } from "./schema";

export function addMissingFocusIconWarnings(focusTrees: FocusTree[], unresolvedIconNames: readonly string[]) {
    const unresolvedIconNameSet = new Set(unresolvedIconNames);
    for (const focusTree of focusTrees) {
        const warnings: FocusWarning[] = [];
        for (const focus of Object.values(focusTree.focuses)) {
            const reportedIconNames = new Set<string>();
            for (const icon of focus.icon) {
                if (!icon.icon || !unresolvedIconNameSet.has(icon.icon) || reportedIconNames.has(icon.icon)) {
                    continue;
                }

                reportedIconNames.add(icon.icon);
                warnings.push({
                    code: 'focus-icon-gfx-missing',
                    severity: 'warning',
                    kind: 'parse',
                    source: focus.id,
                    text: localize('TODO', 'Focus {0} references missing icon GFX {1}.', focus.id, icon.icon),
                    relatedFocusIds: [focus.id],
                    navigations: focus.token
                        ? [{
                            file: focus.file,
                            start: focus.token.start,
                            end: focus.token.end,
                        }]
                        : undefined,
                });
            }
        }

        if (warnings.length > 0) {
            focusTree.warnings = sortFocusWarnings(focusTree.warnings.concat(warnings));
        }
    }
}
