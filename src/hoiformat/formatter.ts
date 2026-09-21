import * as path from 'path';
import { assertHoi4FormattingSafe } from './formatterSafety';
import {
    comparisonOperators,
    directEventCallKeys,
    formatterLineLength,
    guiFormatRules,
    historyMultiLineBodyInlinePreferredBlockKeys,
    orderedEventCallFields,
    orderedInlineBlockFields,
    OrderedBlockFields,
    scriptFormatRules,
} from './formatterRules';
import { FormatToken, Hoi4LineParts, splitHoi4LineComment, tokenizeHoi4Code } from './formatterTokens';

export type Hoi4FormatterProfile = 'script' | 'gui';

export interface Hoi4FormatOptions {
    profile: Hoi4FormatterProfile;
    filePath?: string;
}

export interface Hoi4FormatLineRange {
    startLine: number;
    endLine: number;
}

export function getHoi4FormatterProfile(filePath: string): Hoi4FormatterProfile | undefined {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const extension = path.posix.extname(normalized);

    if (extension === '.gfx' || extension === '.gui') {
        return 'gui';
    }

    if (extension !== '.txt') {
        return undefined;
    }

    if (getScriptRootSegment(normalized) !== undefined) {
        return 'script';
    }

    return undefined;
}

function getScriptRootSegment(normalizedPath: string): string | undefined {
    const segments = stripSteamLibraryPrefix(normalizedPath.split('/').filter(Boolean));
    const excludedRootIndex = Math.max(segments.lastIndexOf('localisation'), segments.lastIndexOf('map'));
    const scriptRootIndex = Math.max(
        segments.lastIndexOf('common'),
        segments.lastIndexOf('events'),
        segments.lastIndexOf('history'),
        segments.lastIndexOf('country_metadata'),
    );

    return scriptRootIndex > excludedRootIndex ? segments[scriptRootIndex] : undefined;
}

// Steam installs games under steamapps/common/<game>; that "common" is not a HOI4 script root.
function stripSteamLibraryPrefix(segments: string[]): string[] {
    const steamAppsIndex = segments.lastIndexOf('steamapps');
    return steamAppsIndex !== -1 && segments[steamAppsIndex + 1] === 'common'
        ? segments.slice(steamAppsIndex + 3)
        : segments;
}

function isHistoryScriptFile(filePath: string | undefined): boolean {
    return filePath !== undefined
        && getScriptRootSegment(filePath.replace(/\\/g, '/').toLowerCase()) === 'history';
}

export function formatHoi4Text(input: string, options: Hoi4FormatOptions): string {
    const bom = input.startsWith('\uFEFF') ? '\uFEFF' : '';
    const content = bom ? input.slice(1) : input;

    const eol = detectEol(content);
    const { lines: rawLines } = splitContentLines(content);

    const { lines: formattedLines } = formatLines(rawLines, options);
    const formattedContent = formattedLines.join(eol) + (content.length > 0 ? eol : '');
    assertHoi4FormattingSafe(content, formattedContent);

    return bom + formattedContent;
}

export function formatHoi4TextRange(input: string, options: Hoi4FormatOptions, range: Hoi4FormatLineRange): string {
    const bom = input.startsWith('\uFEFF') ? '\uFEFF' : '';
    const content = bom ? input.slice(1) : input;

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
    const initialDepth = getLineDepthBefore(rawLines, startLine);
    const { lines: formattedSelectedLines } = formatLines(selectedLines, options, initialDepth);

    const formattedContent = [...beforeLines, ...formattedSelectedLines, ...afterLines].join(eol) + (hadFinalNewline ? eol : '');
    assertHoi4FormattingSafe(content, formattedContent);

    const replacement = formattedSelectedLines.join(eol);
    return startLine === 0 ? bom + replacement : replacement;
}

export function getHoi4ExpectedLineIndent(input: string, options: Hoi4FormatOptions, line: number): string {
    void options;
    const content = input.startsWith('\uFEFF') ? input.slice(1) : input;
    const { lines, hadFinalNewline } = splitContentLines(content);
    if (hadFinalNewline) {
        lines.push('');
    }
    const targetLine = clampLine(line, Math.max(lines.length, 1));
    const depth = getLineDepthBefore(lines, targetLine);
    const currentLine = lines[targetLine] ?? '';
    const tokens = tokenizeHoi4Code(splitHoi4LineComment(currentLine).code.trim());
    const leadingCloseBraces = countLeadingCloseBraces(tokens);

    return '\t'.repeat(Math.max(0, depth - leadingCloseBraces));
}

function getLineDepthBefore(lines: readonly string[], line: number): number {
    let depth = 0;
    for (let index = 0; index < line; index++) {
        depth = Math.max(0, depth + braceDelta(lines[index]));
    }
    return depth;
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

function formatLines(lines: string[], options: Hoi4FormatOptions, initialDepth: number = 0): { lines: string[]; endDepth: number } {
    const { profile } = options;
    const result: string[] = [];
    let depth = initialDepth;

    for (let index = 0; index < lines.length; index++) {
        let parts = splitHoi4LineComment(lines[index]);
        const trimmedCode = parts.code.trim();

        if (profile === 'script' && parts.comment === null && /=\s*$/.test(trimmedCode) && index + 1 < lines.length) {
            const nextParts = splitHoi4LineComment(lines[index + 1]);
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
        lines: profile === 'script'
            ? applyScriptStructuralSpacing(
                collapseSimpleScriptBlocks(splitScriptBlockOpeningContent(result), getMultiLineBodyInlinePreferredBlockKeys(options))
                    .map(canonicalizeScriptLine),
            )
            : result,
        endDepth: depth,
    };
}

function getMultiLineBodyInlinePreferredBlockKeys(options: Hoi4FormatOptions): ReadonlySet<string> {
    return isHistoryScriptFile(options.filePath)
        ? historyMultiLineBodyInlinePreferredBlockKeys
        : scriptFormatRules.multiLineBodyInlinePreferredBlockKeys;
}

// Content written after an opening brace whose closing brace starts a later line moves to its own line,
// unless it is the only entry, which closes back into an inline block. Wrapped lists that also end
// with content before the closing brace keep their layout.
function splitScriptBlockOpeningContent(lines: string[]): string[] {
    const result: string[] = [];

    for (let index = 0; index < lines.length; index++) {
        const opening = parseBlockOpeningContent(lines[index]);
        const closeIndex = opening === undefined ? undefined : findLeadingBlockCloseIndex(lines, index);
        if (opening === undefined || closeIndex === undefined) {
            result.push(lines[index]);
            continue;
        }

        const { indent, key, content, comment } = opening;
        const inline = `${indent}${key} = { ${content} }`;
        if (comment === ''
            && lines[closeIndex] === `${indent}}`
            && lines.slice(index + 1, closeIndex).every(line => line === '')
            && !scriptFormatRules.multilinePreferredBlockKeys.has(key)
            && !(indent.length === 0 && scriptFormatRules.separatedBlockKeys.has(key))
            && inline.length <= formatterLineLength) {
            result.push(inline);
            index = closeIndex;
        } else {
            result.push(`${indent}${key} = {`, `${indent}\t${content}${comment}`);
        }
    }

    return result;
}

// Returns the line whose leading closing brace ends the block opened on openIndex.
function findLeadingBlockCloseIndex(lines: string[], openIndex: number): number | undefined {
    let depth = 1;
    for (let index = openIndex + 1; index < lines.length; index++) {
        const tokens = tokenizeHoi4Code(splitHoi4LineComment(lines[index]).code);
        for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
            depth += tokens[tokenIndex].value === '{' ? 1 : tokens[tokenIndex].value === '}' ? -1 : 0;
            if (depth === 0) {
                return tokenIndex === 0 ? index : undefined;
            }
        }
    }

    return undefined;
}

function parseBlockOpeningContent(line: string): { indent: string; key: string; content: string; comment: string } | undefined {
    const parts = splitHoi4LineComment(line);
    const tokens = tokenizeHoi4Code(parts.code.trim());
    if (tokens.length < 4 || tokens[0].type !== 'word' || tokens[1].value !== '=' || tokens[2].value !== '{') {
        return undefined;
    }

    const contentTokens = tokens.slice(3);
    let depth = 0;
    for (const token of contentTokens) {
        depth += token.value === '{' ? 1 : token.value === '}' ? -1 : 0;
        if (depth < 0) {
            return undefined;
        }
    }
    if (depth !== 0) {
        return undefined;
    }

    return {
        indent: /^\t*/.exec(parts.code)?.[0] ?? '',
        key: tokens[0].value,
        content: formatTokensGeneric(contentTokens),
        comment: parts.comment === null ? '' : parts.code.slice(parts.code.trimEnd().length) + parts.comment,
    };
}

function collapseSimpleScriptBlocks(lines: string[], multiLineBodyKeys: ReadonlySet<string>): string[] {
    let currentLines = lines;

    while (true) {
        const collapsedLines = collapseSimpleScriptBlocksOnce(currentLines, multiLineBodyKeys);
        if (collapsedLines.length === currentLines.length) {
            return collapsedLines;
        }

        currentLines = collapsedLines;
    }
}

function collapseSimpleScriptBlocksOnce(lines: string[], multiLineBodyKeys: ReadonlySet<string>): string[] {
    const result: string[] = [];

    for (let index = 0; index < lines.length; index++) {
        const collapsed = tryCollapseSimpleScriptBlock(lines, index, multiLineBodyKeys);
        if (collapsed !== undefined) {
            result.push(collapsed.line);
            index = collapsed.endIndex;
        } else {
            result.push(lines[index]);
        }
    }

    return result;
}

function tryCollapseSimpleScriptBlock(
    lines: string[],
    startIndex: number,
    multiLineBodyKeys: ReadonlySet<string>,
): { line: string; endIndex: number } | undefined {
    if (startIndex + 2 >= lines.length) {
        return undefined;
    }

    const start = lines[startIndex];
    const match = /^(\t*)([A-Za-z0-9_:.@-]+)\s*=\s*\{$/.exec(start);
    if (match === null) {
        return undefined;
    }

    const [, indent, key] = match;
    if (!canCollapseBlockKey(key, indent.length) && key !== 'limit') {
        return undefined;
    }

    const bodyLines: string[] = [];
    for (let index = startIndex + 1; index < lines.length; index++) {
        const line = lines[index];
        if (line === `${indent}}`) {
            if (bodyLines.length === 0) {
                return undefined;
            }

            if (!canCollapseBlockBody(key, bodyLines, multiLineBodyKeys)) {
                return undefined;
            }

            const orderedBodyLines = orderKnownBlockBodyLines(key, bodyLines);
            if (orderedBodyLines === undefined) {
                return undefined;
            }

            const inline = `${indent}${key} = { ${orderedBodyLines.map(bodyLine => bodyLine.trim()).join(' ')} }`;
            return inline.length <= formatterLineLength
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

function canCollapseBlockBody(key: string, bodyLines: string[], multiLineBodyKeys: ReadonlySet<string>): boolean {
    if (key === 'limit') {
        return bodyLines.length === 1 && /^\s*has_template\s*=/.test(bodyLines[0]);
    }

    return bodyLines.length === 1 || multiLineBodyKeys.has(key);
}

function orderKnownBlockBodyLines(key: string, bodyLines: string[]): string[] | undefined {
    const fields = orderedInlineBlockFields.get(key)
        ?? (directEventCallKeys.has(key) ? orderedEventCallFields : undefined);
    if (fields === undefined) {
        return bodyLines;
    }

    const parsedFields = parseOrderedFields(bodyLines.map(line => tokenizeHoi4Code(line.trim())), fields);
    return parsedFields?.map(tokens => formatTokensGeneric(tokens));
}

function canonicalizeScriptLine(line: string): string {
    const parts = splitHoi4LineComment(line);
    const indent = /^\t*/.exec(parts.code)?.[0] ?? '';
    const tokens = tokenizeHoi4Code(parts.code.trim());
    if (tokens.length < 5 || tokens[1]?.value !== '=' || tokens[2]?.value !== '{' || tokens[tokens.length - 1]?.value !== '}') {
        return line;
    }

    const key = tokens[0].value;
    const innerTokens = tokens.slice(3, -1);
    if (indent.length > 0 && directEventCallKeys.has(key) && isIdOnlyBlock(innerTokens)) {
        return appendOriginalComment(`${indent}${key} = ${innerTokens[2].value}`, parts);
    }

    const fields = orderedInlineBlockFields.get(key)
        ?? (indent.length > 0 && directEventCallKeys.has(key) ? orderedEventCallFields : undefined);
    if (fields === undefined) {
        return line;
    }

    const orderedFields = parseOrderedFields([innerTokens], fields);
    if (orderedFields === undefined) {
        return line;
    }

    const inner = orderedFields.map(field => formatTokensGeneric(field)).join(' ');
    return appendOriginalComment(`${indent}${key} = { ${inner} }`, parts);
}

function isIdOnlyBlock(tokens: FormatToken[]): boolean {
    return tokens.length === 3
        && tokens[0].value === 'id'
        && tokens[1].value === '='
        && (tokens[2].type === 'word' || tokens[2].type === 'string');
}

function parseOrderedFields(
    tokenLines: FormatToken[][],
    fields: OrderedBlockFields,
): FormatToken[][] | undefined {
    const allowedFields = new Set(fields.order);
    const parsed = new Map<string, FormatToken[]>();

    for (const tokens of tokenLines) {
        let index = 0;
        while (index < tokens.length) {
            const fieldToken = tokens[index];
            if (fieldToken === undefined) {
                return undefined;
            }

            const field = fieldToken.value;
            if (!allowedFields.has(field) || parsed.has(field) || !comparisonOperators.has(tokens[index + 1]?.value)) {
                return undefined;
            }

            let end = index + 2;
            while (end < tokens.length && !(allowedFields.has(tokens[end].value) && comparisonOperators.has(tokens[end + 1]?.value))) {
                end++;
            }
            if (end === index + 2) {
                return undefined;
            }

            parsed.set(field, tokens.slice(index, end));
            index = end;
        }
    }

    if (fields.required.some(field => !parsed.has(field))) {
        return undefined;
    }

    return fields.order.flatMap(field => {
        const tokens = parsed.get(field);
        return tokens === undefined ? [] : [tokens];
    });
}

function appendOriginalComment(code: string, parts: Hoi4LineParts): string {
    if (parts.comment === null) {
        return code;
    }

    const commentGap = parts.code.slice(parts.code.trimEnd().length);
    return code + commentGap + parts.comment;
}

function canCollapseBodyLine(line: string, parentDepth: number): boolean {
    return line.trim() !== ''
        && splitHoi4LineComment(line).comment === null
        && getIndentDepth(line) === parentDepth + 1
        && braceDelta(line) === 0;
}

function canCollapseBlockKey(key: string, indentDepth: number): boolean {
    if (scriptFormatRules.multilinePreferredBlockKeys.has(key)) {
        return false;
    }

    if (indentDepth === 0 && scriptFormatRules.separatedBlockKeys.has(key)) {
        return false;
    }

    return scriptFormatRules.inlinePreferredBlockKeys.has(key) || isUppercaseScopeLikeKey(key);
}

function isUppercaseScopeLikeKey(key: string): boolean {
    return /^[A-Z][A-Z0-9_:.@-]*$/.test(key);
}

function applyScriptStructuralSpacing(lines: string[]): string[] {
    const result: string[] = [];

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (line === '' && nextNonBlankLine(lines, index + 1)?.trim() === '}') {
            continue;
        }

        if (shouldInsertBlankBeforeScriptLine(line, result)) {
            result.push('');
        }

        result.push(line);
    }

    return result;
}

function nextNonBlankLine(lines: string[], startIndex: number): string | undefined {
    for (let index = startIndex; index < lines.length; index++) {
        if (lines[index].trim() !== '') {
            return lines[index];
        }
    }

    return undefined;
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
    return match !== null && scriptFormatRules.separatedBlockKeys.has(match[1]);
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
    const tokens = tokenizeHoi4Code(splitHoi4LineComment(line).code.trim());
    return countToken(tokens, '{') - countToken(tokens, '}');
}

function formatLine(parts: Hoi4LineParts, depth: number, profile: Hoi4FormatterProfile): { line: string; depthDelta: number } {
    const trimmedCode = parts.code.trim();

    if (trimmedCode === '') {
        return {
            line: parts.comment === null ? '' : '\t'.repeat(depth) + parts.comment.trimEnd(),
            depthDelta: 0,
        };
    }

    const tokens = tokenizeHoi4Code(trimmedCode);
    const leadingCloseBraces = countLeadingCloseBraces(tokens);
    const lineDepth = Math.max(0, depth - leadingCloseBraces);
    const code = formatTokens(tokens, profile);
    const commentGap = parts.comment === null ? '' : parts.code.slice(parts.code.trimEnd().length);
    const comment = parts.comment?.trimEnd() ?? '';
    const line = '\t'.repeat(lineDepth) + code + commentGap + comment;

    return {
        line,
        depthDelta: countToken(tokens, '{') - countToken(tokens, '}'),
    };
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
    const hasVectorKey = guiFormatRules.vectorKeys.has(key);
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
