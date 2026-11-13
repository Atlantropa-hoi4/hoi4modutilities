import { Node, parseHoi4File, resolveScriptVariables } from "../../hoiformat/hoiparser";
import { readNodeAsString } from "../../hoiformat/schema";
import { NumberPosition } from "../../util/common";
import { ContentLoader, Dependency, LoadResultOD, LoaderSession } from "../../util/loader/loader";
import { localize } from "../../util/i18n";

export interface FocusSpacingLoaderResult {
    focusSpacing?: NumberPosition;
}

export class FocusSpacingLoader extends ContentLoader<FocusSpacingLoaderResult> {
    protected async postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<FocusSpacingLoaderResult>> {
        if (error || content === undefined) {
            throw error;
        }

        session.throwIfCancelled();
        const guiDependencies = dependencies.filter(dependency => dependency.type === 'gui').map(dependency => dependency.path);
        const loaded = await this.loaderDependencies.loadMultiple(guiDependencies, session, FocusSpacingLoader);
        session.throwIfCancelled();
        // Match GuiFileLoader's referenced-files-first order without loading GUI assets.
        const inheritedSpacing = loaded.map(result => result.result.focusSpacing).find(spacing => spacing !== undefined);
        const focusSpacing = inheritedSpacing ?? extractFocusSpacing(parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file)));
        return {
            result: {
                focusSpacing,
            },
            dependencies: [...new Set([this.file, ...guiDependencies, ...loaded.flatMap(result => result.dependencies)])],
        };
    }

    public toString() {
        return `[FocusSpacingLoader ${this.file}]`;
    }
}

export function extractFocusSpacing(root: Node): NumberPosition | undefined {
    let legacySpacing: NumberPosition | undefined;
    for (const node of iterateNodes(resolveScriptVariables(root))) {
        if (!Array.isArray(node.value)) {
            continue;
        }
        if (node.name?.toLowerCase() === 'positiontype') {
            const name = node.value.find(child => child.name?.toLowerCase() === 'name');
            if (name && readNodeAsString(name)?.toLowerCase() === 'focus_spacing') {
                const position = node.value.find(child => child.name?.toLowerCase() === 'position');
                const spacing = position && readSpacing(position);
                if (spacing) { return spacing; }
            }
        } else if (node.name?.toLowerCase() === 'focus_spacing' && !legacySpacing) {
            legacySpacing = readSpacing(node);
        }
    }
    return legacySpacing;
}

function readSpacing(node: Node): NumberPosition | undefined {
    const x = readNumberChildValue(node, 'x');
    const y = readNumberChildValue(node, 'y');
    return x === undefined || y === undefined ? undefined : { x, y };
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
        return Number.isFinite(child.value) ? child.value : undefined;
    }

    if (typeof child.value === 'object' && child.value !== null && 'name' in child.value) {
        const parsed = Number(child.value.name);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}
