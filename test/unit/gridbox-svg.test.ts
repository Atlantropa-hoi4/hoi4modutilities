import * as assert from 'assert';
import { renderSvgConnections } from '../../src/util/hoi4gui/gridboxcommon';

describe('gridbox SVG connections', () => {
    it('renders one SVG path for each logical connection', () => {
        const html = renderSvgConnections({
            a: {
                id: 'a',
                gridX: 0,
                gridY: 0,
                connections: [{
                    target: 'b',
                    targetType: 'parent',
                    style: '1px dashed rgba(1, 2, 3, 0.5)',
                    classNames: 'focus-connection focus-connection-source-a focus-connection-target-b',
                }],
            },
            b: { id: 'b', gridX: 2, gridY: 2, connections: [] },
        }, 'up', { width: 96, height: 130 }, { width: 0, height: 0 }, 0.5);

        assert.strictEqual((html.match(/<path /g) ?? []).length, 1);
        assert.ok(html.includes('focus-connection-source-a'));
        assert.ok(html.includes('stroke-dasharray="6 4"'));
        assert.strictEqual((html.match(/<div/g) ?? []).length, 0);
    });
});
