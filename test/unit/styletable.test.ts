import * as assert from 'assert';
import { StyleTable } from '../../src/util/styletable';

describe('style table', () => {
    it('keeps numbered one-time styles by default', () => {
        const styleTable = new StyleTable();
        assert.strictEqual(styleTable.oneTimeStyle('slot', () => 'left: 0;'), 'st-slot-0');
        assert.strictEqual(styleTable.oneTimeStyle('slot', () => 'left: 0;'), 'st-slot-1');
    });

    it('shares content-addressed one-time styles within and across tables', () => {
        const first = new StyleTable({ contentAddressedOneTimeStyles: true });
        const second = new StyleTable({ contentAddressedOneTimeStyles: true });
        const left = first.oneTimeStyle('slot', () => 'left: 0;');
        assert.strictEqual(first.oneTimeStyle('slot', () => 'left: 0;'), left);
        assert.notStrictEqual(first.oneTimeStyle('slot', () => 'left: 1px;'), left);
        assert.strictEqual(second.oneTimeStyle('slot', () => 'left: 0;'), left);
        assert.notStrictEqual(first.oneTimeStyle('slot', () => 'left: 0;', ':hover'), left);
        assert.strictEqual(first.rules().length, 3);
    });

    it('names asynchronous one-time styles after their resolved content', async () => {
        const styleTable = new StyleTable({ contentAddressedOneTimeStyles: true });
        const asyncName = await styleTable.oneTimeStyle('slot', async () => 'top: 2px;');
        assert.strictEqual(styleTable.oneTimeStyle('slot', () => 'top: 2px;'), asyncName);
    });

    it('omits rules that already exist with identical content', () => {
        const base = new StyleTable({ contentAddressedOneTimeStyles: true });
        base.style('icon', () => 'width: 10px;');
        base.oneTimeStyle('slot', () => 'left: 0;');
        const existing = new Map(base.rules());

        const patch = new StyleTable({ contentAddressedOneTimeStyles: true });
        patch.style('icon', () => 'width: 12px;');
        patch.oneTimeStyle('slot', () => 'left: 0;');
        patch.oneTimeStyle('slot', () => 'left: 5px;');
        const css = patch.toStyleContent(existing);

        assert.match(css, /\.st-icon \{ width: 12px; \}/);
        assert.doesNotMatch(css, /left: 0;/);
        assert.match(css, /left: 5px;/);
    });
});
