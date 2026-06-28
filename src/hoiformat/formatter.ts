import * as path from 'path';
import { parseHoi4File } from './hoiparser';

export type Hoi4FormatterProfile = 'script' | 'gui';

export interface Hoi4FormatOptions {
    profile: Hoi4FormatterProfile;
    filePath?: string;
}

export interface Hoi4FormatLineRange {
    startLine: number;
    endLine: number;
}

type FormatTokenType = 'word' | 'string' | 'operator';

interface FormatToken {
    value: string;
    type: FormatTokenType;
}

interface LineParts {
    code: string;
    comment: string | null;
}

const comparisonOperators = new Set(['=', '>', '<', '>=', '<=', '!=']);
const vectorKeys = new Set(['position', 'size', 'borderSize', 'offset', 'rotation', 'scale']);
const separatedBlockKeys = new Set([
    'focus',
    'shared_focus',
    'joint_focus',
    'country_event',
    'news_event',
    'state_event',
    'unit_leader_event',
    'ace_event',
]);
const inlinePreferredBlockKeys = new Set([
    'country_event',
    'news_event',
    'state_event',
    'unit_leader_event',
    'ace_event',
    'white_peace',
    'allowed',
    'hidden_trigger',
    'check_variable',
    'set_rule',
    'custom_trigger_tooltip',
    'ai_will_do',
    'NOT',
    'OR',
    'AND',
    'FROM',
    'ROOT',
    'PREV',
    'THIS',
]);
const multiLineBodyInlinePreferredBlockKeys = new Set([
    'country_event',
    'news_event',
    'state_event',
    'unit_leader_event',
    'ace_event',
]);
const multilinePreferredBlockKeys = new Set([
    'focus_tree',
    'focus',
    'shared_focus',
    'joint_focus',
    'completion_reward',
    'timeout_effect',
    'immediate',
    'option',
    'available',
    'allow_branch',
    'modifier',
    'prerequisite',
    'mutually_exclusive',
    'trigger',
    'visible',
    'complete_effect',
    'remove_trigger',
    'cancel_trigger',
    'custom_cost_trigger',
    'text',
    'bypass',
    'names',
    'provinces',
    'research_bonus',
    'equipment_bonus',
    'if',
    'else',
    'else_if',
    'limit',
    'hidden_effect',
    'effect_tooltip',
    'every_country',
    'random_country',
    'every_state',
    'random_state',
    'every_owned_state',
    'random_owned_state',
]);

export function getHoi4FormatterProfile(filePath: string): Hoi4FormatterProfile | undefined {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const extension = path.posix.extname(normalized);

    if (extension === '.gfx' || extension === '.gui') {
        return 'gui';
    }

    if (extension !== '.txt') {
        return undefined;
    }

    const segments = normalized.split('/').filter(Boolean);
    if (segments.includes('localisation') || segments.includes('map')) {
        return undefined;
    }

    if (segments.includes('common') || segments.includes('events') || segments.includes('history') || segments.includes('country_metadata')) {
        return 'script';
    }

    return undefined;
}

export function formatHoi4Text(input: string, options: Hoi4FormatOptions): string {
    const bom = input.startsWith('\uFEFF') ? '\uFEFF' : '';
    const content = bom ? input.slice(1) : input;
    parseHoi4File(content);

    const eol = detectEol(content);
    const { lines: rawLines, hadFinalNewline } = splitContentLines(content);

    const { lines: formattedLines } = formatLines(rawLines, options.profile);
    const formattedContent = formattedLines.join(eol) + (hadFinalNewline ? eol : '');
    parseHoi4File(formattedContent);

    return bom + formattedContent;
}

export function formatHoi4TextRange(input: string, options: Hoi4FormatOptions, range: Hoi4FormatLineRange): string {
    const bom = input.startsWith('\uFEFF') ? '\uFEFF' : '';
    const content = bom ? input.slice(1) : input;
    parseHoi4File(content);

    const eol = detectEol(content);
    const { lines: rawLines, hadFinalNewline } = splitContentLines(content);
    if (rawLines.length === 0) {
        return bom;
    }

    const startLine = clampLine(range.startLine, rawLines.length);
    const endLine = clampLine(range.endLine, rawLines.length);
    if (endLine < startLine) {
        return '';
    }

    const beforeLines = rawLines.slice(0, startLine);
    const selectedLines = rawLines.slice(startLine, endLine + 1);
    const afterLines = rawLines.slice(endLine + 1);
    const initialDepth = formatLines(beforeLines, options.profile).endDepth;
    const { lines: formattedSelectedLines } = formatLines(selectedLines, options.profile, initialDepth);

    const formattedContent = [...beforeLines, ...formattedSelectedLines, ...afterLines].join(eol) + (hadFinalNewline ? eol : '');
    parseHoi4File(formattedContent);

    const replacement = formattedSelectedLines.join(eol);
    return startLine === 0 ? bom + replacement : replacement;
}

export function getHoi4ExpectedLineIndent(input: string, options: Hoi4FormatOptions, line: number): string {
    const content = input.startsWith('\uFEFF') ? input.slice(1) : input;
    const { lines } = splitContentLines(content);
    const targetLine = clampLine(line, Math.max(lines.length, 1));
    const depth = formatLines(lines.slice(0, targetLine), options.profile).endDepth;
    const currentLine = lines[targetLine] ?? '';
    const tokens = tokenizeCode(splitLineComment(currentLine).code.trim());
    const leadingCloseBraces = countLeadingCloseBraces(tokens);

    return '\t'.repeat(Math.max(0, depth - leadingCloseBraces));
}

function detectEol(input: string): string {
    return input.includes('\r\n') ? '\r\n' : '\n';
}

function hasFinalNewline(input: string): boolean {
    return input.endsWith('\n') || input.endsWith('\r');
}

function splitContentLines(content: string): { lines: string[]; hadFinalNewline: boolean } {
    const hadFinalNewline = hasFinalNewline(content);
    const lines = content.split(/\r\n|\n|\r/);
    if (hadFinalNewline) {
        lines.pop();
    }

    return { lines, hadFinalNewline };
}

function clampLine(line: number, lineCount: number): number {
    return Math.max(0, Math.min(Math.max(0, lineCount - 1), line));
}

function formatLines(lines: string[], profile: Hoi4FormatterProfile, initialDepth: number = 0): { lines: string[]; endDepth: number } {
    const result: string[] = [];
    let depth = initialDepth;

    for (let index = 0; index < lines.length; index++) {
        let parts = splitLineComment(lines[index]);
        const trimmedCode = parts.code.trim();

        if (profile === 'script' && parts.comment === null && /=\s*$/.test(trimmedCode) && index + 1 < lines.length) {
            const nextParts = splitLineComment(lines[index + 1]);
            if (nextParts.comment === null && nextParts.code.trim() === '{') {
                parts = {
                    code: `${parts.code.replace(/\s*$/, '')} {`,
                    comment: null,
                };
                index++;
            }
        }

        const formatted = formatLine(parts, depth, profile);
        if (formatted.line !== '' || result[result.length - 1] !== '') {
            result.push(formatted.line);
        }
        depth = Math.max(0, depth + formatted.depthDelta);
    }

    return {
        lines: profile === 'script' ? applyScriptStructuralSpacing(collapseSimpleScriptBlocks(result)) : result,
        endDepth: depth,
    };
}

function collapseSimpleScriptBlocks(lines: string[]): string[] {
    const result: string[] = [];

    for (let index = 0; index < lines.length; index++) {
        const collapsed = tryCollapseSimpleScriptBlock(lines, index);
        if (collapsed !== undefined) {
            result.push(collapsed.line);
            index = collapsed.endIndex;
        } else {
            result.push(lines[index]);
        }
    }

    return result;
}

function tryCollapseSimpleScriptBlock(lines: string[], startIndex: number): { line: string; endIndex: number } | undefined {
    if (startIndex + 2 >= lines.length) {
        return undefined;
    }

    const start = lines[startIndex];
    const match = /^(\t*)([A-Za-z0-9_:.@-]+)\s*=\s*\{$/.exec(start);
    if (match === null) {
        return undefined;
    }

    const [, indent, key] = match;
    if (!canCollapseBlockKey(key, indent.length)) {
        return undefined;
    }

    const bodyLines: string[] = [];
    for (let index = startIndex + 1; index < lines.length; index++) {
        const line = lines[index];
        if (line === `${indent}}`) {
            if (bodyLines.length === 0) {
                return undefined;
            }

            if (bodyLines.length > 1 && !multiLineBodyInlinePreferredBlockKeys.has(key)) {
                return undefined;
            }

            const inline = `${indent}${key} = { ${bodyLines.map(bodyLine => bodyLine.trim()).join(' ')} }`;
            return inline.length <= 140
                ? { line: inline, endIndex: index }
                : undefined;
        }

        if (!canCollapseBodyLine(line, indent.length)) {
            return undefined;
        }

        bodyLines.push(line);
    }

    return undefined;
}

function canCollapseBodyLine(line: string, parentDepth: number): boolean {
    return line.trim() !== ''
        && splitLineComment(line).comment === null
        && getIndentDepth(line) === parentDepth + 1
        && braceDelta(line) === 0;
}

function canCollapseBlockKey(key: string, indentDepth: number): boolean {
    if (multilinePreferredBlockKeys.has(key)) {
        return false;
    }

    if (indentDepth === 0 && separatedBlockKeys.has(key)) {
        return false;
    }

    return inlinePreferredBlockKeys.has(key) || isUppercaseScopeLikeKey(key);
}

function isUppercaseScopeLikeKey(key: string): boolean {
    return /^[A-Z][A-Z0-9_:.@-]*$/.test(key);
}

function applyScriptStructuralSpacing(lines: string[]): string[] {
    const result: string[] = [];

    for (const line of lines) {
        if (shouldInsertBlankBeforeScriptLine(line, result)) {
            result.push('');
        }

        result.push(line);
    }

    return result;
}

function shouldInsertBlankBeforeScriptLine(line: string, previousLines: string[]): boolean {
    if (previousLines.length === 0 || previousLines[previousLines.length - 1] === '') {
        return false;
    }

    const trimmed = line.trim();
    if (trimmed === '') {
        return false;
    }

    const previous = previousNonBlankLine(previousLines);
    if (previous === undefined) {
        return false;
    }

    if (isSeparatedBlockStart(line)) {
        return previous.trim() === '}' || isSectionComment(previous);
    }

    return isSectionComment(line) && previous.trim() === '}';
}

function previousNonBlankLine(lines: string[]): string | undefined {
    for (let index = lines.length - 1; index >= 0; index--) {
        if (lines[index].trim() !== '') {
            return lines[index];
        }
    }

    return undefined;
}

function isSeparatedBlockStart(line: string): boolean {
    if (getIndentDepth(line) > 1) {
        return false;
    }

    const match = /^([A-Za-z0-9_:.@-]+)\s*=\s*\{/.exec(line.trim());
    return match !== null && separatedBlockKeys.has(match[1]);
}

function isSectionComment(line: string): boolean {
    return /^#{2,}/.test(line.trim());
}

function getIndentDepth(line: string): number {
    let depth = 0;
    while (line[depth] === '\t') {
        depth++;
    }

    return depth;
}

function braceDelta(line: string): number {
    const tokens = tokenizeCode(splitLineComment(line).code.trim());
    return countToken(tokens, '{') - countToken(tokens, '}');
}

function splitLineComment(line: string): LineParts {
    const commentStart = findCommentStart(line);
    if (commentStart === -1) {
        return {
            code: line,
            comment: null,
        };
    }

    return {
        code: line.slice(0, commentStart),
        comment: line.slice(commentStart),
    };
}

function findCommentStart(line: string): number {
    let inString = false;
    let escaped = false;
    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === '#') {
            return index;
        }
    }

    return -1;
}

function formatLine(parts: LineParts, depth: number, profile: Hoi4FormatterProfile): { line: string; depthDelta: number } {
    const trimmedCode = parts.code.trim();
    const comment = normalizeComment(parts.comment, trimmedCode !== '');

    if (trimmedCode === '') {
        return {
            line: comment === null ? '' : '\t'.repeat(depth) + comment,
            depthDelta: 0,
        };
    }

    const tokens = tokenizeCode(trimmedCode);
    const leadingCloseBraces = countLeadingCloseBraces(tokens);
    const lineDepth = Math.max(0, depth - leadingCloseBraces);
    const code = formatTokens(tokens, profile);
    const line = '\t'.repeat(lineDepth) + code + (comment === null ? '' : ` ${comment}`);

    return {
        line,
        depthDelta: countToken(tokens, '{') - countToken(tokens, '}'),
    };
}

function normalizeComment(comment: string | null, hasCode: boolean): string | null {
    if (comment === null) {
        return null;
    }

    const trimmedComment = comment.trim();
    if (hasCode && trimmedComment === '#') {
        return null;
    }

    return trimmedComment;
}

function tokenizeCode(code: string): FormatToken[] {
    const tokens: FormatToken[] = [];
    let index = 0;

    while (index < code.length) {
        const char = code[index];
        if (/\s/.test(char)) {
            index++;
            continue;
        }

        const next = code[index + 1] ?? '';
        if ((char === '>' || char === '<' || char === '!') && next === '=') {
            tokens.push({ value: char + next, type: 'operator' });
            index += 2;
            continue;
        }

        if ('{}=<>;,'.includes(char)) {
            tokens.push({ value: char, type: 'operator' });
            index++;
            continue;
        }

        if (char === '"') {
            const end = findStringEnd(code, index);
            tokens.push({ value: code.slice(index, end), type: 'string' });
            index = end;
            continue;
        }

        let end = index + 1;
        while (end < code.length && !/\s/.test(code[end]) && !'{}=<>;,'.includes(code[end])) {
            if ((code[end] === '!' || code[end] === '<' || code[end] === '>') && code[end + 1] === '=') {
                break;
            }
            end++;
        }
        tokens.push({ value: code.slice(index, end), type: 'word' });
        index = end;
    }

    return tokens;
}

function findStringEnd(code: string, start: number): number {
    let escaped = false;
    for (let index = start + 1; index < code.length; index++) {
        const char = code[index];
        if (escaped) {
            escaped = false;
        } else if (char === '\\') {
            escaped = true;
        } else if (char === '"') {
            return index + 1;
        }
    }

    return code.length;
}

function countLeadingCloseBraces(tokens: FormatToken[]): number {
    let count = 0;
    while (tokens[count]?.value === '}') {
        count++;
    }

    return count;
}

function countToken(tokens: FormatToken[], value: string): number {
    return tokens.filter(token => token.value === value).length;
}

function formatTokens(tokens: FormatToken[], profile: Hoi4FormatterProfile): string {
    if (profile === 'gui') {
        const guiVector = tryFormatGuiVectorLine(tokens);
        if (guiVector !== undefined) {
            return guiVector;
        }
    }

    return formatTokensGeneric(tokens);
}

function tryFormatGuiVectorLine(tokens: FormatToken[]): string | undefined {
    if (tokens.length < 5 || tokens[1]?.value !== '=' || tokens[2]?.value !== '{' || tokens[tokens.length - 1]?.value !== '}') {
        return undefined;
    }

    if (tokens.slice(3, -1).some(token => token.value === '{' || token.value === '}')) {
        return undefined;
    }

    const key = tokens[0].value;
    const hasVectorKey = vectorKeys.has(key);
    const hasVectorContent = tokens.slice(3, -1).some(token => /^(?:x|y|width|height)$/i.test(token.value));
    if (!hasVectorKey && !hasVectorContent) {
        return undefined;
    }

    const inner = formatTokensGeneric(tokens.slice(3, -1));
    return `${key} = {${inner === '' ? '' : ` ${inner} `}}`;
}

function formatTokensGeneric(tokens: FormatToken[]): string {
    let result = '';

    for (const token of tokens) {
        if (token.value === ',' || token.value === ';') {
            result = result.trimEnd() + token.value;
            continue;
        }

        if (comparisonOperators.has(token.value)) {
            result = result.trimEnd() + ` ${token.value} `;
            continue;
        }

        if (token.value === '{') {
            result = result.trimEnd() + (result === '' ? '{' : ' {');
            continue;
        }

        if (token.value === '}') {
            if (result === '') {
                result = '}';
            } else {
                result = result.trimEnd() + ' }';
            }
            continue;
        }

        if (result === '' || result.endsWith(' ')) {
            result += token.value;
        } else {
            result += ` ${token.value}`;
        }
    }

    return result.trimEnd();
}
