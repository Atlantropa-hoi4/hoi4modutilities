export type FormatTokenType = 'word' | 'string' | 'operator';

export interface FormatToken {
    value: string;
    type: FormatTokenType;
}

export interface Hoi4LineParts {
    code: string;
    comment: string | null;
}

export function splitHoi4LineComment(line: string): Hoi4LineParts {
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

export function tokenizeHoi4Code(code: string): FormatToken[] {
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

export function collectHoi4CommentSignature(input: string): string[] {
    return input.split(/\r\n|\n|\r/).flatMap(line => {
        const comment = splitHoi4LineComment(line).comment;
        return comment === null ? [] : [comment.trimEnd()];
    });
}

export function collectHoi4SeparatorSignature(input: string): string[] {
    return input.split(/\r\n|\n|\r/).flatMap(line => tokenizeHoi4Code(splitHoi4LineComment(line).code)
        .filter(token => token.value === ',' || token.value === ';')
        .map(token => token.value));
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
