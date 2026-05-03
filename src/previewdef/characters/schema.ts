import { isSymbolNode } from '../../hoiformat/schema';
import { Node, Token } from '../../hoiformat/hoiparser';

export type CharacterPortraitSize = 'large' | 'small';

export interface CharacterPortrait {
    role: string;
    size: CharacterPortraitSize;
    sprite: string;
    token: Token | undefined;
}

export interface CharacterPreviewItem {
    id: string;
    name: string | undefined;
    token: Token | undefined;
    file: string;
    portraits: CharacterPortrait[];
}

export function getCharactersFromFile(root: Node, filePath: string): CharacterPreviewItem[] {
    if (!Array.isArray(root.value)) {
        return [];
    }

    const charactersRoot = root.value.find(child => child.name === 'characters' && Array.isArray(child.value));
    if (!charactersRoot || !Array.isArray(charactersRoot.value)) {
        return [];
    }

    const characters: CharacterPreviewItem[] = [];
    for (const characterNode of charactersRoot.value) {
        if (!characterNode.name || !Array.isArray(characterNode.value)) {
            continue;
        }

        const name = getScalarChildValue(characterNode, 'name');
        const portraitsNode = characterNode.value.find(child => child.name === 'portraits' && Array.isArray(child.value));
        characters.push({
            id: characterNode.name,
            name,
            token: characterNode.nameToken ?? undefined,
            file: filePath,
            portraits: portraitsNode ? collectPortraits(portraitsNode) : [],
        });
    }

    return characters;
}

function getScalarChildValue(node: Node, childName: string): string | undefined {
    if (!Array.isArray(node.value)) {
        return undefined;
    }

    const child = node.value.find(candidate => candidate.name === childName);
    return child ? getScalarValue(child) : undefined;
}

function collectPortraits(portraitsNode: Node): CharacterPortrait[] {
    const portraits: CharacterPortrait[] = [];
    collectPortraitsInNode(portraitsNode, [], portraits);
    return portraits;
}

function collectPortraitsInNode(node: Node, rolePath: string[], portraits: CharacterPortrait[]): void {
    if (!Array.isArray(node.value)) {
        return;
    }

    for (const child of node.value) {
        if (child.name === 'large' || child.name === 'small') {
            const sprite = getScalarValue(child);
            if (sprite) {
                portraits.push({
                    role: rolePath.join('.') || 'portrait',
                    size: child.name,
                    sprite,
                    token: child.valueStartToken ?? child.nameToken ?? undefined,
                });
            }
            continue;
        }

        if (child.name && Array.isArray(child.value)) {
            collectPortraitsInNode(child, [...rolePath, child.name], portraits);
        }
    }
}

function getScalarValue(node: Node): string | undefined {
    if (isSymbolNode(node.value)) {
        return node.value.name;
    }

    if (typeof node.value === 'string') {
        return node.value;
    }

    if (typeof node.value === 'number') {
        return String(node.value);
    }

    return undefined;
}
