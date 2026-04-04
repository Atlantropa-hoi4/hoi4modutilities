import * as assert from 'assert';
import { buildFocusMinimapModel, createFocusMinimapTransform, getFocusMinimapViewportRect, getScrollTargetForCanvasPoint } from '../../src/previewdef/focustree/focusminimap';

describe('focus tree minimap helpers', () => {
    it('projects focus positions into canvas points while preserving selection and search flags', () => {
        const model = buildFocusMinimapModel({
            positions: {
                LEFT_TOP: { x: -2, y: -1 },
                RIGHT_BOTTOM: { x: 4, y: 6 },
            },
            xGridSize: 96,
            yGridSize: 130,
            leftPadding: 242,
            topPadding: 180,
            canvasWidth: 1200,
            canvasHeight: 1400,
            selectedFocusIds: ['RIGHT_BOTTOM'],
            searchedFocusIds: ['LEFT_TOP'],
            lastNavigatedFocusId: 'RIGHT_BOTTOM',
            continuousCanvasPoint: { x: 820, y: 1180 },
        });

        assert.strictEqual(model.canvasWidth, 1200);
        assert.strictEqual(model.canvasHeight, 1400);
        const leftTop = model.points.find(point => point.focusId === 'LEFT_TOP');
        const rightBottom = model.points.find(point => point.focusId === 'RIGHT_BOTTOM');
        assert.deepStrictEqual(leftTop, {
            focusId: 'LEFT_TOP',
            canvasX: 98,
            canvasY: 115,
            isSelected: false,
            isSearched: true,
            isLastNavigated: false,
        });
        assert.deepStrictEqual(rightBottom, {
            focusId: 'RIGHT_BOTTOM',
            canvasX: 674,
            canvasY: 1025,
            isSelected: true,
            isSearched: false,
            isLastNavigated: true,
        });
        assert.deepStrictEqual(model.continuousPoint, {
            canvasX: 820,
            canvasY: 1180,
            label: 'Continuous focuses',
        });
    });

    it('calculates a minimap viewport rectangle from scroll and scale', () => {
        const transform = createFocusMinimapTransform(1200, 1600, 176, 220, 8);
        const rect = getFocusMinimapViewportRect({
            scrollX: 880,
            scrollY: 1260,
            contentPageLeft: -20,
            contentPageTop: 68,
            scale: 0.8,
            viewportWidth: 1600,
            viewportHeight: 900,
            transform,
            canvasWidth: 1200,
            canvasHeight: 1600,
        });

        assert.ok(rect.left >= transform.offsetX);
        assert.ok(rect.top >= transform.offsetY);
        assert.ok(rect.width >= 8);
        assert.ok(rect.height >= 8);
    });

    it('converts a canvas point into the correct main preview scroll target', () => {
        const target = getScrollTargetForCanvasPoint({
            canvasPoint: { x: 640, y: 920 },
            contentPageLeft: -20,
            contentPageTop: 68,
            scale: 0.6,
            viewportWidth: 1440,
            viewportHeight: 900,
        });

        assert.deepStrictEqual(target, {
            x: -356,
            y: 170,
        });
    });
});
