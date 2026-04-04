import { Node, parseHoi4File } from "../../hoiformat/hoiparser";

const definiteMioKeys = new Set([
    'add_trait',
    'override_trait',
    'remove_trait',
]);

const mioTraitDetailKeys = new Set([
    'token',
    'position',
    'parent',
    'any_parent',
    'all_parents',
    'mutually_exclusive',
    'relative_position_id',
    'special_trait_background',
    'visible',
    'equipment_bonus',
    'production_bonus',
    'organization_modifier',
]);

export function getMioPreviewPriority(text: string): number | undefined {
    try {
        return getMioPreviewPriorityFromNode(parseHoi4File(text));
    } catch {
        return undefined;
    }
}

function getMioPreviewPriorityFromNode(root: Node): number | undefined {
    if (!Array.isArray(root.value)) {
        return undefined;
    }

    for (const definition of root.value) {
        if (!Array.isArray(definition.value)) {
            continue;
        }

        for (const child of definition.value) {
            if (!child.nameToken || !child.name) {
                continue;
            }

            if (definiteMioKeys.has(child.name)) {
                return child.nameToken.start;
            }

            if ((child.name === 'trait' || child.name === 'add_trait' || child.name === 'override_trait') && hasMioTraitShape(child)) {
                return child.nameToken.start;
            }
        }
    }

    return undefined;
}

function hasMioTraitShape(node: Node): boolean {
    return Array.isArray(node.value)
        && node.value.some(child => child.name !== null && mioTraitDetailKeys.has(child.name));
}
