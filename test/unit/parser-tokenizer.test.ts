import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tokenizeHoi4 } from '../../src/hoiformat/hoiparser';
import { getFixturePath } from '../testUtils';

type ReferenceToken = { value: string; start: number; end: number; type: string };

// The regular-expression tokenizer that the character scanner replaced. Its alternation and
// backtracking behavior defines the expected token stream.
function referenceTokenize(input: string): ReferenceToken[] {
    const alternatives: Array<[string, string]> = [
        ['comment', String.raw`#.*(?:[\r\n]|$)`],
        ['operator', String.raw`>=|<=|!=|[={}<>;,]`],
        ['string', String.raw`"(?:\\"|\\\\|[^"])*"`],
        ['unitnumber', String.raw`[+-]?(?:0x[0-9a-fA-F]+|(?:\d+\.\d*|\.\d+|\d+))(?:%%?)`],
        ['number', String.raw`[+-]?(?:0x[0-9a-fA-F]+|(?:\d+\.\d*|\.\d+|\d+))(?![\w.])`],
        ['symbol', String.raw`[^\s#={}<>!,;]+`],
        ['eof', '$'],
    ];
    const regex = new RegExp(String.raw`\s*(?<result>` + alternatives.map(([name, source]) => `(?<${name}>${source})`).join('|') + ')', 'y');
    const tokens: ReferenceToken[] = [];
    let pos = 0;
    while (true) {
        regex.lastIndex = pos;
        const match = regex.exec(input);
        if (!match) {
            throw new Error(`Invalid token at ${pos}`);
        }
        const result = match.groups!.result;
        pos += match[0].length;
        const type = alternatives.find(([name]) => match.groups![name] !== undefined)![0];
        if (type === 'comment') {
            continue;
        }
        tokens.push({ value: result, start: pos - result.length, end: pos, type });
        if (type === 'eof') {
            return tokens;
        }
    }
}

function compare(input: string): void {
    let expected: ReferenceToken[] | undefined;
    try {
        expected = referenceTokenize(input);
    } catch {
        expected = undefined;
    }
    if (!expected) {
        assert.throws(() => tokenizeHoi4(input), /Invalid token/, `expected an invalid token for ${JSON.stringify(input)}`);
        return;
    }
    const actual = tokenizeHoi4(input).map(({ value, start, end, type }) => ({ value, start, end, type }));
    assert.deepStrictEqual(actual, expected, `token mismatch for ${JSON.stringify(input)}`);
}

function listScriptFixtures(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return listScriptFixtures(fullPath);
        }
        return /\.(txt|gui|gfx)$/i.test(entry.name) ? [fullPath] : [];
    });
}

describe('HOI4 script tokenizer', () => {
    it('matches the regular-expression tokenizer on every script fixture', () => {
        const files = listScriptFixtures(getFixturePath());
        assert.ok(files.length > 10);
        for (const file of files) {
            compare(fs.readFileSync(file, 'utf8'));
        }
    });

    it('matches regular-expression backtracking on edge cases', () => {
        const backslash = '\\';
        for (const input of [
            '', '   ', '#', '# comment', '#a\r\nb', '#a b', 'a#b', 'a=b', 'a>=b', 'a!=b', 'a != b', '!', '!x',
            '"', '"abc', `"a${backslash}"`, `"a${backslash}"b${backslash}"c`, `"a${backslash}${backslash}"b`,
            `"a${backslash}${backslash}${backslash}"b`, `"${backslash}`, '"x" "y"', 'x"y"',
            '1', '-1', '+1', '1.', '.5', '1.5.3', '0x1F', '0X1F', '0x', '0xG', '0x1G', '12%', '12%%', '12.5%', '.5%', '0x1f%',
            '1a', '1_', '1.x', '-', '+', '-.', '1e5', '100%abc', 'a=1.5}', 'x={1 2 3}', 'x = { y = @z }',
            '﻿a = b', 'a = b', 'tag = GER; x = 1,', 'a = "b" c = d',
        ]) {
            compare(input);
        }
    });

    it('matches the regular-expression tokenizer on generated inputs', () => {
        const alphabet = ['#', '"', '\\', '=', '<', '>', '!', '{', '}', ',', ';', '%', '+', '-', '.', '0', '1', '9',
            'x', 'a', 'F', '_', ' ', '\n', '\r', '\t', ' ', ' ', '﻿', 'ä', '@', ':'];
        let seed = 0x9e3779b9;
        const random = () => {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return (seed >>> 0) / 0x100000000;
        };
        for (let sample = 0; sample < 4000; sample++) {
            const length = 1 + Math.floor(random() * 24);
            let input = '';
            for (let index = 0; index < length; index++) {
                input += alphabet[Math.floor(random() * alphabet.length)];
            }
            compare(input);
        }
    });
});
