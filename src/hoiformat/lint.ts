import { Node, NodeValue, parseHoi4File } from './hoiparser';
import { getHoi4FormatterProfile } from './formatter';

export type Hoi4LintRule =
    | 'legacy-check-variable'
    | 'redundant-single-option-ai-chance'
    | 'localisation-version-marker';

export interface Hoi4LintFinding {
    rule: Hoi4LintRule;
    start: number;
    end: number;
    replacement: string;
}

const eventDefinitionKeys = new Set([
    'country_event',
    'news_event',
    'state_event',
    'unit_leader_event',
    'ace_event',
]);

const comparisonReplacements = new Map<string, { operator: string; negate: boolean }>([
    ['less_than', { operator: '<', negate: false }],
    ['greater_than', { operator: '>', negate: false }],
    ['equals', { operator: '=', negate: false }],
    ['less_than_or_equals', { operator: '>', negate: true }],
    ['greater_than_or_equals', { operator: '<', negate: true }],
    ['not_equals', { operator: '=', negate: true }],
]);

export function collectHoi4LintFindings(text: string, filePath: string): Hoi4LintFinding[] {
    if (isLocalisationFile(filePath)) {
        return collectLocalisationVersionFindings(text);
    }

    if (getHoi4FormatterProfile(filePath) !== 'script') {
        return [];
    }

    const bomOffset = text.startsWith('\uFEFF') ? 1 : 0;
    const content = bomOffset === 0 ? text : text.slice(1);
    if (!hasBalancedScriptBraces(content)) {
        return [];
    }

    let root: Node;
    try {
        root = parseHoi4File(content);
    } catch {
        return [];
    }

    const aiChanceFindings = collectRedundantAiChanceFindings(root, text, bomOffset);
    const checkVariableFindings: Hoi4LintFinding[] = [];
    visitNodes(root.value, node => {
        const finding = createCheckVariableFinding(node, text, bomOffset);
        if (finding !== undefined && !aiChanceFindings.some(aiFinding => rangesOverlap(finding, aiFinding))) {
            checkVariableFindings.push(finding);
        }
    });

    return [...aiChanceFindings, ...checkVariableFindings].sort((left, right) => left.start - right.start);
}

function createCheckVariableFinding(node: Node, text: string, offset: number): Hoi4LintFinding | undefined {
    if (node.name !== 'check_variable' || node.operator !== '=' || !Array.isArray(node.value)) {
        return undefined;
    }

    const children = node.value;
    if (children.length !== 3 || children.some(child => child.operator !== '=')) {
        return undefined;
    }

    const fields = new Map(children.map(child => [child.name, child]));
    if (fields.size !== 3 || !fields.has('var') || !fields.has('value') || !fields.has('compare')) {
        return undefined;
    }

    const variable = fields.get('var')!;
    const value = fields.get('value')!;
    const compare = fields.get('compare')!;
    const comparison = readSymbol(compare.value);
    const replacementKind = comparison === undefined ? undefined : comparisonReplacements.get(comparison);
    const range = getNodeRange(node, offset);
    if (replacementKind === undefined || range === undefined || containsComment(text.slice(range.start, range.end))) {
        return undefined;
    }

    const variableText = getNodeValueText(variable, text, offset);
    const valueText = getNodeValueText(value, text, offset);
    if (variableText === undefined || valueText === undefined || !isScalarValue(variable.value) || !isScalarValue(value.value)) {
        return undefined;
    }

    const comparisonText = `check_variable = { ${variableText} ${replacementKind.operator} ${valueText} }`;
    return {
        rule: 'legacy-check-variable',
        ...range,
        replacement: replacementKind.negate ? `NOT = { ${comparisonText} }` : comparisonText,
    };
}

function collectRedundantAiChanceFindings(root: Node, text: string, offset: number): Hoi4LintFinding[] {
    if (!Array.isArray(root.value)) {
        return [];
    }

    const findings: Hoi4LintFinding[] = [];
    for (const eventNode of root.value) {
        if (!eventDefinitionKeys.has(eventNode.name ?? '') || !Array.isArray(eventNode.value)) {
            continue;
        }

        const options = eventNode.value.filter(child => child.name === 'option' && Array.isArray(child.value));
        if (options.length !== 1) {
            continue;
        }

        const optionChildren = options[0].value as Node[];
        const aiChanceNodes = optionChildren.filter(child => child.name === 'ai_chance' && Array.isArray(child.value));
        if (aiChanceNodes.length !== 1) {
            continue;
        }

        const aiChance = aiChanceNodes[0];
        const range = getNodeRange(aiChance, offset);
        if (range === undefined
            || containsComment(text.slice(range.start, range.end))
            || containsComment(getLineSuffix(text, range.end))) {
            continue;
        }

        findings.push({
            rule: 'redundant-single-option-ai-chance',
            ...expandStandaloneLineRange(text, range),
            replacement: '',
        });
    }

    return findings;
}

function collectLocalisationVersionFindings(text: string): Hoi4LintFinding[] {
    const findings: Hoi4LintFinding[] = [];
    const linePattern = /^(?:\uFEFF)?(?:[ \t]*)([^\s:#]+):([0-9]+)(?=[ \t])/gm;
    let match: RegExpExecArray | null;
    while ((match = linePattern.exec(text)) !== null) {
        const version = match[2];
        const versionStart = match.index + match[0].length - version.length;
        findings.push({
            rule: 'localisation-version-marker',
            start: versionStart,
            end: versionStart + version.length,
            replacement: '',
        });
    }

    return findings;
}

function visitNodes(value: NodeValue, callback: (node: Node) => void): void {
    if (!Array.isArray(value)) {
        return;
    }

    for (const node of value) {
        callback(node);
        visitNodes(node.value, callback);
    }
}

function getNodeRange(node: Node, offset: number): { start: number; end: number } | undefined {
    if (node.nameToken === null || node.valueEndToken === null) {
        return undefined;
    }

    return {
        start: node.nameToken.start + offset,
        end: node.valueEndToken.end + offset,
    };
}

function getNodeValueText(node: Node, text: string, offset: number): string | undefined {
    if (node.valueStartToken === null || node.valueEndToken === null) {
        return undefined;
    }

    return text.slice(node.valueStartToken.start + offset, node.valueEndToken.end + offset);
}

function isScalarValue(value: NodeValue): boolean {
    return typeof value === 'string' || typeof value === 'number' || readSymbol(value) !== undefined;
}

function readSymbol(value: NodeValue): string | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && 'name' in value
        ? value.name
        : undefined;
}

function containsComment(text: string): boolean {
    let quoted = false;
    let escaped = false;
    for (const character of text) {
        if (quoted && escaped) {
            escaped = false;
        } else if (quoted && character === '\\') {
            escaped = true;
        } else if (character === '"') {
            quoted = !quoted;
        } else if (!quoted && character === '#') {
            return true;
        }
    }

    return false;
}

function hasBalancedScriptBraces(text: string): boolean {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let comment = false;
    for (const character of text) {
        if (comment) {
            if (character === '\n' || character === '\r') {
                comment = false;
            }
        } else if (quoted && escaped) {
            escaped = false;
        } else if (quoted && character === '\\') {
            escaped = true;
        } else if (character === '"') {
            quoted = !quoted;
        } else if (!quoted && character === '#') {
            comment = true;
        } else if (!quoted && character === '{') {
            depth++;
        } else if (!quoted && character === '}') {
            depth--;
            if (depth < 0) {
                return false;
            }
        }
    }

    return depth === 0 && !quoted;
}

function expandStandaloneLineRange(text: string, range: { start: number; end: number }): { start: number; end: number } {
    const lineStart = Math.max(text.lastIndexOf('\n', range.start - 1) + 1, 0);
    const nextNewline = text.indexOf('\n', range.end);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline + 1;
    const before = text.slice(lineStart, range.start);
    const afterWithoutNewline = text.slice(range.end, nextNewline === -1 ? text.length : nextNewline).replace(/\r$/, '');

    return /^\s*$/.test(before) && /^\s*$/.test(afterWithoutNewline)
        ? { start: lineStart, end: lineEnd }
        : range;
}

function getLineSuffix(text: string, offset: number): string {
    const nextNewline = text.indexOf('\n', offset);
    return text.slice(offset, nextNewline === -1 ? text.length : nextNewline);
}

function rangesOverlap(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
    return left.start < right.end && right.start < left.end;
}

function isLocalisationFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return /\.(?:yml|yaml)$/.test(normalized)
        && /(?:^|\/)locali[sz]ation\//.test(normalized);
}
