import { flatten } from "lodash";
import { applyCondition, ConditionItem } from "../../src/hoiformat/condition";
import type { Technology } from "../../src/previewdef/technology/schema";

export interface TechnologyXorGroups {
    tech: Technology;
    nonXors: Technology[];
    xorGroups: Technology[][];
}

export function getAllowedTechnologies(
    technologies: Technology[],
    selectedExprs: ConditionItem[],
): Technology[] {
    const allowedById: Record<string, boolean> = {};
    for (const technology of technologies) {
        if (technology.allowBranch !== undefined) {
            allowedById[technology.id] = applyCondition(technology.allowBranch, selectedExprs);
        }
    }

    propagateHiddenTechnologyBranches(technologies, allowedById);
    return technologies.filter(technology => allowedById[technology.id] !== false);
}

function propagateHiddenTechnologyBranches(
    technologies: Technology[],
    allowedById: Record<string, boolean>,
): void {
    const technologyById = Object.fromEntries(technologies.map(technology => [technology.id, technology]));
    const parentsById: Record<string, Technology[]> = {};
    for (const technology of technologies) {
        for (const childId of technology.leadsToTechs) {
            if (technologyById[childId]) {
                (parentsById[childId] ??= []).push(technology);
            }
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const technology of technologies) {
            if (allowedById[technology.id] === false) {
                continue;
            }

            const parents = parentsById[technology.id];
            if (parents?.length && parents.every(parent => allowedById[parent.id] === false)) {
                allowedById[technology.id] = false;
                changed = true;
            }
        }
    }
}

export function findTechnologyXorGroups(
    treeMap: Record<string, Technology>,
    technology: Technology,
    folder: string,
    allowedTechnologyIds: ReadonlySet<string>,
): TechnologyXorGroups | undefined {
    const techChildren = technology.leadsToTechs
        .map(techName => treeMap[techName])
        .filter((tech): tech is Technology =>
            tech !== undefined
            && allowedTechnologyIds.has(tech.id)
            && folder in tech.folders);
    const xorGroupMap: Record<string, Technology[]> = {};

    for (const techChild of techChildren) {
        const techChildXors = techChild.xor
            .map(techName => treeMap[techName])
            .filter((techChildXor): techChildXor is Technology =>
                techChildXor !== undefined
                && allowedTechnologyIds.has(techChildXor.id)
                && folder in techChildXor.folders
                && techChildXor !== techChild
                && techChildXor.xor.includes(techChild.id));
        if (techChildXors.length === 0) {
            continue;
        }

        const groups = techChildXors
            .map(tech => xorGroupMap[tech.id])
            .filter((value, index, values) => value !== undefined && index === values.indexOf(value));
        const bigGroup = flatten(groups).concat([techChild]);
        bigGroup.forEach(tech => xorGroupMap[tech.id] = bigGroup);
    }

    const xorGroups = Object.values(xorGroupMap).filter((value, index, values) => index === values.indexOf(value));
    if (xorGroups.length === 0) {
        return undefined;
    }

    const nonXors = techChildren.filter(tech => !xorGroups.some(group => group.includes(tech)));
    return { tech: technology, nonXors, xorGroups };
}
