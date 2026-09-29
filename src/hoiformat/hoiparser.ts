import { UserError } from '../util/common';

export type NodeValue = string | number | Node[] | SymbolNode | null;

export interface Node {
    name: string | null;
    operator: string | null;
    value: NodeValue;
    valueAttachment: SymbolNode | null;
    valueAttachmentToken: Token | null;
    nameToken: Token | null;
    operatorToken: Token | null;
    valueStartToken: Token | null;
    valueEndToken: Token | null;
}

export interface SymbolNode {
    name: string;
}

interface Tokenizer<T extends string> {
    peek: () => Token<T>;
    next: () => Token<T>;
    throw: (message: string, prev?: boolean) => never;
}

export interface Token<T extends string = string> {
    value: string;
    start: number;
    end: number;
    type: T;
}

export interface ParseOptions {
    keepTokens?: boolean;
}

type HOITokenType = 'comment' | 'symbol' | 'operator' | 'string' | 'number' | 'unitnumber' | 'eof';

const charTab = 9;
const charLineFeed = 10;
const charCarriageReturn = 13;
const charSpace = 32;
const charExclamation = 33;
const charQuote = 34;
const charHash = 35;
const charPercent = 37;
const charPlus = 43;
const charComma = 44;
const charMinus = 45;
const charDot = 46;
const charZero = 48;
const charNine = 57;
const charSemicolon = 59;
const charLess = 60;
const charEquals = 61;
const charGreater = 62;
const charBackslash = 92;
const charLowerX = 120;
const charOpenBrace = 123;
const charCloseBrace = 125;

/** Matches the JavaScript regular expression class `\s`. */
function isWhitespace(code: number): boolean {
    if (code <= charSpace) {
        return code === charSpace || (code >= charTab && code <= charCarriageReturn);
    }
    if (code < 0xa0) {
        return false;
    }
    return code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028
        || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

function isDigit(code: number): boolean {
    return code >= charZero && code <= charNine;
}

function isHexDigit(code: number): boolean {
    return isDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/** Matches `\w` or `.`, which may not follow a plain number. */
function isNumberSuffixChar(code: number): boolean {
    return isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === charDot;
}

function isOperatorChar(code: number): boolean {
    return code === charEquals || code === charOpenBrace || code === charCloseBrace || code === charLess
        || code === charGreater || code === charSemicolon || code === charComma;
}

/** Matches the symbol class `[^\s#={}<>!,;]`. */
function isSymbolChar(code: number): boolean {
    return !isWhitespace(code) && code !== charHash && code !== charExclamation && !isOperatorChar(code);
}

function countDigits(input: string, start: number): number {
    let end = start;
    while (end < input.length && isDigit(input.charCodeAt(end))) {
        end++;
    }
    return end - start;
}

/**
 * Ends of the numeric bodies `0x[0-9a-fA-F]+`, `\d+\.\d*`, `\.\d+`, and `\d+` at `start`, in the
 * order the former regular expression tried them. Only the longest match of each body can be
 * followed by a character other than a digit, so shorter backtracking candidates never match.
 */
function getNumberBodyEnds(input: string, start: number): number[] {
    const ends: number[] = [];
    const first = input.charCodeAt(start);
    if (first === charZero && input.charCodeAt(start + 1) === charLowerX) {
        let end = start + 2;
        while (end < input.length && isHexDigit(input.charCodeAt(end))) {
            end++;
        }
        if (end > start + 2) {
            ends.push(end);
        }
    }
    const integerDigits = countDigits(input, start);
    if (integerDigits > 0 && input.charCodeAt(start + integerDigits) === charDot) {
        ends.push(start + integerDigits + 1 + countDigits(input, start + integerDigits + 1));
    }
    if (first === charDot) {
        const fractionDigits = countDigits(input, start + 1);
        if (fractionDigits > 0) {
            ends.push(start + 1 + fractionDigits);
        }
    }
    if (integerDigits > 0) {
        ends.push(start + integerDigits);
    }
    return ends;
}

/**
 * Scans one token at `start` (after whitespace). Alternatives are tried in the order of the
 * former regular expression: comment, operator, string, unit number, number, symbol, end.
 * Returns the token end and type, or undefined for an invalid token.
 */
function scanToken(input: string, start: number): { end: number; type: HOITokenType } | undefined {
    const length = input.length;
    if (start >= length) {
        return { end: start, type: 'eof' };
    }

    const code = input.charCodeAt(start);
    if (code === charHash) {
        for (let index = start + 1; index < length; index++) {
            const next = input.charCodeAt(index);
            if (next === charLineFeed || next === charCarriageReturn) {
                return { end: index + 1, type: 'comment' };
            }
            if (next === 0x2028 || next === 0x2029) {
                return undefined;
            }
        }
        return { end: length, type: 'comment' };
    }

    if (code === charGreater || code === charLess || code === charExclamation) {
        if (input.charCodeAt(start + 1) === charEquals) {
            return { end: start + 2, type: 'operator' };
        }
    }
    if (isOperatorChar(code)) {
        return { end: start + 1, type: 'operator' };
    }

    if (code === charQuote) {
        let lastEscapedQuote = -1;
        let index = start + 1;
        while (index < length) {
            const next = input.charCodeAt(index);
            if (next === charBackslash && index + 1 < length) {
                const escaped = input.charCodeAt(index + 1);
                if (escaped === charQuote) {
                    lastEscapedQuote = index + 1;
                    index += 2;
                    continue;
                }
                if (escaped === charBackslash) {
                    index += 2;
                    continue;
                }
            } else if (next === charQuote) {
                return { end: index + 1, type: 'string' };
            }
            index++;
        }
        // Without a closing quote, backtracking ended the string at the last escaped quote.
        if (lastEscapedQuote >= 0) {
            return { end: lastEscapedQuote + 1, type: 'string' };
        }
    }

    const bodyStart = code === charPlus || code === charMinus ? start + 1 : start;
    const bodyEnds = getNumberBodyEnds(input, bodyStart);
    for (const end of bodyEnds) {
        if (input.charCodeAt(end) === charPercent) {
            return { end: input.charCodeAt(end + 1) === charPercent ? end + 2 : end + 1, type: 'unitnumber' };
        }
    }
    for (const end of bodyEnds) {
        if (end >= length || !isNumberSuffixChar(input.charCodeAt(end))) {
            return { end, type: 'number' };
        }
    }

    if (isSymbolChar(code)) {
        let end = start + 1;
        while (end < length && isSymbolChar(input.charCodeAt(end))) {
            end++;
        }
        return { end, type: 'symbol' };
    }

    return undefined;
}

function tokenizer(input: string, errorMessagePrefix: string = ''): Tokenizer<HOITokenType> {
    let prevPos = 0;
    let pos = 0;
    let token: Token<HOITokenType> | null = null;

    function nextToken(): Token<HOITokenType> {
        prevPos = pos;
        while (true) {
            let start = pos;
            while (start < input.length && isWhitespace(input.charCodeAt(start))) {
                start++;
            }
            const scanned = scanToken(input, start);
            if (!scanned) {
                throwError('Invalid token');
            }

            pos = scanned.end;
            if (scanned.type !== 'comment') {
                return {
                    value: input.slice(start, scanned.end),
                    start,
                    end: scanned.end,
                    type: scanned.type,
                };
            }
        }
    }

    function peek(): Token<HOITokenType> {
        return token ??= nextToken();
    }

    function throwError(message: string, prev: boolean = false): never {
        // Successful parses only need token offsets, not a line index for diagnostics.
        let sum = 0;
        const lineLengthSums = input.split('\n').map(v => v.length).map(v => sum = (sum+ v + 1));
        const calculatePos = prev ? prevPos : pos;
        const line = lineLengthSums.findIndex(v => v > calculatePos);
        const column = line > 0 ? calculatePos - lineLengthSums[line - 1] : calculatePos;
        const posString = line === -1 ?
            ` at (${lineLengthSums.length}, ${lineLengthSums.length > 1 ? lineLengthSums[lineLengthSums.length - 1] - lineLengthSums[lineLengthSums.length - 2] + 1 : lineLengthSums[lineLengthSums.length - 1] + 1})` :
            ` at (${line + 1}, ${column + 1})`;
        throw new UserError(errorMessagePrefix + message + `${posString}: ` + (input + "(EOF)").substring(calculatePos, Math.min(calculatePos + 30, input.length + 5)));
    }

    return {
        peek,
        next: () => {
            const result = peek();
            token = null;
            return result;
        },
        throw: throwError,
    };
}
/** Tokens of an HOI4 script, without comments and ending with an `eof` token. */
export function tokenizeHoi4(input: string): Token[] {
    const tokens = tokenizer(input);
    const result: Token[] = [];
    let token: Token<HOITokenType>;
    do {
        token = tokens.next();
        result.push(token);
    } while (token.type !== 'eof');
    return result;
}

export function parseHoi4File(input: string, errorMessagePrefix: string = '', options: ParseOptions = {}): Node {
    const keepTokens = options.keepTokens !== false;
    const tokens = tokenizer(input, errorMessagePrefix);
    const value = parseBlockContent(tokens, keepTokens);

    if (tokens.peek().type !== 'eof') {
        console.warn("File content can't be completely parsed");
    }

    return {
        name: null,
        nameToken: null,
        operator: null,
        operatorToken: null,
        value,
        valueStartToken: null,
        valueEndToken: null,
        valueAttachment: null,
        valueAttachmentToken: null,
    };
}

function parseNode(tokens: Tokenizer<HOITokenType>, keepTokens: boolean): Node {
    const name = tokens.next();
    if (name.value === '{') {
        const value = parseBlockContent(tokens, keepTokens);
        const right = tokens.next();
        if (right.value !== '}' && right.type !== 'eof') {
            tokens.throw("Expect a '}'", true);
        }
        return {
            name: null,
            nameToken: null,
            operator: null,
            operatorToken: null,
            value,
            valueStartToken: keepTokens ? name : null,
            valueEndToken: keepTokens ? right : null,
            valueAttachment: null,
            valueAttachmentToken: null,
        };
    }

    if (name.type !== 'string' && name.type !== 'symbol' && name.type !== 'number' && name.type !== 'unitnumber') {
        tokens.throw("Expect name to be symbol, string, number or unit number", true);
    }

    let nextToken = tokens.peek();
    if (nextToken.type !== 'operator' || isSeparatorToken(nextToken) || nextToken.value === '}') {
        while (isSeparatorToken(nextToken)) {
            tokens.next();
            nextToken = tokens.peek();
        }

        return {
            name: name.type === 'string' ? decodeStringToken(name) : name.value,
            nameToken: keepTokens ? name : null,
            operator: null,
            operatorToken: null,
            value: null,
            valueStartToken: null,
            valueEndToken: null,
            valueAttachment: null,
            valueAttachmentToken: null,
        };
    }

    let operator: Token<HOITokenType>;
    if (nextToken.value === '{') {
        operator = {
            ...nextToken,
            value: '=',
        };
    } else {
        operator = tokens.next();
    }

    let valueAttachment: SymbolNode | null = null;
    let valueAttachmentToken: Token | null = null;
    let [value, valueStartToken, valueEndToken] = parseNodeValue(tokens, keepTokens);

    if (value !== null && typeof value === 'object' && 'name' in value) {
        const nextToken = tokens.peek();
        if (nextToken.value === '{') {
            valueAttachment = value;
            valueAttachmentToken = valueStartToken;
            [value, valueStartToken, valueEndToken] = parseNodeValue(tokens, keepTokens);
        }
    }

    let tailComma = tokens.peek();
    while (isSeparatorToken(tailComma)) {
        tokens.next();
        tailComma = tokens.peek();
    }

    return {
        name: name.type === 'string' ? decodeStringToken(name) : name.value,
        nameToken: keepTokens ? name : null,
        operator: operator.value,
        operatorToken: keepTokens ? operator : null,
        value,
        valueStartToken: keepTokens ? valueStartToken : null,
        valueEndToken: keepTokens ? valueEndToken : null,
        valueAttachment,
        valueAttachmentToken: keepTokens ? valueAttachmentToken : null,
    };
}

function isSeparatorToken(token: Token<HOITokenType>): boolean {
    return token.value === ',' || token.value === ';';
}

function parseNodeValue(tokens: Tokenizer<HOITokenType>, keepTokens: boolean): [ NodeValue, Token<HOITokenType>, Token<HOITokenType> ] {
    const nextToken = tokens.next();
    switch (nextToken.type) {
        case 'string':
            return [
                decodeStringToken(nextToken),
                nextToken,
                nextToken,
            ];
        case 'number':
            const nextTokenValue = nextToken.value;
            return [
                parseNumberToken(nextTokenValue),
                nextToken,
                nextToken,
            ];
        case 'symbol':
        case 'unitnumber':
            return [
                { name: nextToken.value },
                nextToken,
                nextToken,
            ];
        case 'operator':
            if (nextToken.value === '{') {
                const result = parseBlockContent(tokens, keepTokens);
                const right = tokens.next();
                if (right.value !== '}' && right.type !== 'eof') {
                    tokens.throw("Expect a '}'", true);
                }
                return [
                    result,
                    nextToken,
                    right,
                ];
            }
            break;
    }
    
    tokens.throw("Expect string, number, symbol, or {", true);
}

/** Resolve top-level and nested HOI4 @constant references in a parsed tree. */
export function resolveScriptVariables(root: Node): Node {
    const constants: Record<string, number | string> = {};
    const collect = (node: Node): void => {
        if (node.name?.startsWith('@') && (typeof node.value === 'number' || typeof node.value === 'string')) {
            constants[node.name] = node.value;
        }
        if (Array.isArray(node.value)) {
            node.value.forEach(collect);
        }
    };
    collect(root);

    const substitute = (node: Node): void => {
        if (Array.isArray(node.value)) {
            node.value.forEach(substitute);
        } else if (node.value !== null && typeof node.value === 'object' && 'name' in node.value) {
            const constant = constants[node.value.name];
            if (node.value.name.startsWith('@') && constant !== undefined) {
                node.value = constant;
            }
        }
    };
    substitute(root);
    return root;
}

function decodeStringToken(token: Token<HOITokenType>): string {
    return token.value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseNumberToken(value: string): number {
    const sign = value.startsWith('-') ? -1 : 1;
    const unsignedValue = value.replace(/^[+-]/, '');
    if (unsignedValue.toLowerCase().startsWith('0x')) {
        return sign * parseInt(unsignedValue.substring(2), 16);
    }

    return parseFloat(value);
}

function parseBlockContent(tokens: Tokenizer<HOITokenType>, keepTokens: boolean): Node[] {
    const nodes: Node[] = [];

    while (true) {
        const nextToken = tokens.peek();
        if (nextToken.type === 'eof' || nextToken.value === "}") {
            break;
        }

        nodes.push(parseNode(tokens, keepTokens));
    }

    return nodes;
}
