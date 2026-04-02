import { Node, parseHoi4File } from "../../hoiformat/hoiparser";
import { NumberPosition } from "../../util/common";
import { ContentLoader, LoadResultOD, LoaderSession } from "../../util/loader/loader";
import { localize } from "../../util/i18n";

export interface FocusSpacingLoaderResult {
    focusSpacing?: NumberPosition;
}

export class FocusSpacingLoader extends ContentLoader<FocusSpacingLoaderResult> {
    protected async postLoad(content: string | undefined, _dependencies: never[], error: any, _session: LoaderSession): Promise<LoadResultOD<FocusSpacingLoaderResult>> {
        if (error || content === undefined) {
            throw error;
        }

        return {
            result: {
                focusSpacing: extractFocusSpacing(parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file))),
            },
        };
    }

    public toString() {
        return `[FocusSpacingLoader ${this.file}]`;
    }
}

export function extractFocusSpacing(root: Node): NumberPosition | undefined {
    for (const node of iterateNodes(root)) {
        if (node.name?.toLowerCase() !== 'focus_spacing' || !Array.isArray(node.value)) {
            continue;
        }

        const x = readNumberChildValue(node, 'x');
        const y = readNumberChildValue(node, 'y');
        if (x === undefined || y === undefined) {
            continue;
        }

        return { x, y };
    }

    return undefined;
}

function* iterateNodes(node: Node): Generator<Node> {
    if (!Array.isArray(node.value)) {
        return;
    }

    for (const child of node.value) {
        yield child;
        yield* iterateNodes(child);
    }
}

function readNumberChildValue(node: Node, expectedName: string): number | undefined {
    if (!Array.isArray(node.value)) {
        return undefined;
    }

    const child = node.value.find(value => value.name?.toLowerCase() === expectedName);
    if (!child) {
        return undefined;
    }

    if (typeof child.value === 'number') {
        return child.value;
    }

    if (typeof child.value === 'object' && child.value !== null && 'name' in child.value) {
        const parsed = Number(child.value.name);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}
