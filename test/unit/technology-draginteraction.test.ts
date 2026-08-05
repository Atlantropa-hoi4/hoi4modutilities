import * as assert from 'assert';
import {
    getMovedTechnologyPosition,
    getTechnologyDoubleClickCreateParent,
    getTechnologyGridDelta,
    getTechnologyGridGeometry,
    hasTechnologyDragPassedThreshold,
    registerTechnologyPointerGesture,
} from '../../src/previewdef/technology/draginteraction';

describe('technology drag interaction', () => {
    it('normalizes zoom and snaps pointer movement for every gridbox format', () => {
        const slot = { width: 100, height: 50 };
        assert.deepStrictEqual(getTechnologyGridDelta(200, 100, 2, 'up', slot), { x: 1, y: 1 });
        assert.deepStrictEqual(getTechnologyGridDelta(200, 100, 2, 'down', slot), { x: 1, y: -1 });
        assert.deepStrictEqual(getTechnologyGridDelta(200, 100, 2, 'left', slot), { x: 1, y: 1 });
        assert.deepStrictEqual(getTechnologyGridDelta(200, 100, 2, 'right', slot), { x: 1, y: -1 });
    });

    it('uses a threshold and preserves the starting position', () => {
        assert.strictEqual(hasTechnologyDragPassedThreshold(3, -3, 4), false);
        assert.strictEqual(hasTechnologyDragPassedThreshold(4, 0, 4), true);
        assert.deepStrictEqual(getMovedTechnologyPosition({ x: 5, y: 8 }, { x: -2, y: 3 }), { x: 3, y: 11 });
    });

    it('uses one selected technology in the target tree as the double-click create parent', () => {
        const roots = { root: 'root', child: 'root', other: 'other' };
        assert.strictEqual(getTechnologyDoubleClickCreateParent(['child'], 'root', roots), 'child');
        assert.strictEqual(getTechnologyDoubleClickCreateParent(['child', 'root'], 'root', roots), 'root');
        assert.strictEqual(getTechnologyDoubleClickCreateParent(['other'], 'root', roots), 'root');
    });

    it('reads grid geometry without depending on a rendered technology item', () => {
        assert.deepStrictEqual(getTechnologyGridGeometry({
            gridFormat: 'left',
            slotWidth: '100',
            slotHeight: '50',
            gridWidth: '800',
            gridHeight: '600',
        }), {
            format: 'left',
            slotSize: { width: 100, height: 50 },
            gridSize: { width: 800, height: 600 },
        });
        assert.strictEqual(getTechnologyGridGeometry({ gridWidth: '800' }), undefined);
        assert.strictEqual(getTechnologyGridGeometry({
            slotWidth: '0',
            slotHeight: '50',
            gridWidth: '800',
            gridHeight: '600',
        }), undefined);
        assert.strictEqual(getTechnologyGridGeometry({
            slotWidth: 'not-a-number',
            slotHeight: '50',
            gridWidth: '800',
            gridHeight: '600',
        }), undefined);
    });

    it('registers and removes pointercancel with the marquee gesture listeners', () => {
        const listeners = new Map<string, (event: PointerEvent) => void>();
        const removed: string[] = [];
        const target = {
            addEventListener: (type: string, listener: (event: PointerEvent) => void) => listeners.set(type, listener),
            removeEventListener: (type: string) => removed.push(type),
        };
        const cleanup = registerTechnologyPointerGesture(
            target,
            () => undefined,
            () => undefined,
            () => undefined,
        );

        assert.deepStrictEqual(Array.from(listeners.keys()), ['pointermove', 'pointerup', 'pointercancel']);
        cleanup();
        assert.deepStrictEqual(removed, ['pointermove', 'pointerup', 'pointercancel']);
    });
});
