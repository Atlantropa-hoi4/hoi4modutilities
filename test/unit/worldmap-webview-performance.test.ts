import * as assert from 'assert';
import { BehaviorSubject } from 'rxjs';
import { AnimationFrameScheduler } from '../../webviewsrc/worldmap/framescheduler';
import { ResourceImageCache } from '../../webviewsrc/worldmap/resourceimagecache';
import { nextBehaviorSubjectIfChanged } from '../../webviewsrc/worldmap/subject';

describe('world map webview frame scheduling', () => {
    it('coalesces work into one frame and cancels pending work on dispose', () => {
        const callbacks = new Map<number, FrameRequestCallback>();
        const cancelledHandles: number[] = [];
        let nextHandle = 0;
        let runCount = 0;
        const scheduler = new AnimationFrameScheduler(
            () => runCount++,
            callback => {
                const handle = ++nextHandle;
                callbacks.set(handle, callback);
                return handle;
            },
            handle => {
                cancelledHandles.push(handle);
                callbacks.delete(handle);
            },
        );

        scheduler.schedule();
        scheduler.schedule();
        scheduler.schedule();
        assert.strictEqual(callbacks.size, 1);

        const firstCallback = callbacks.get(1)!;
        callbacks.delete(1);
        firstCallback(0);
        assert.strictEqual(runCount, 1);

        scheduler.schedule();
        assert.strictEqual(callbacks.size, 1);
        scheduler.dispose();
        assert.deepStrictEqual(cancelledHandles, [2]);
        assert.strictEqual(callbacks.size, 0);

        scheduler.schedule();
        assert.strictEqual(callbacks.size, 0);
        assert.strictEqual(runCount, 1);
    });

    it('emits BehaviorSubject values only when they change', () => {
        const subject = new BehaviorSubject<number | undefined>(undefined);
        const values: (number | undefined)[] = [];
        subject.subscribe(value => values.push(value));

        assert.strictEqual(nextBehaviorSubjectIfChanged(subject, undefined), false);
        assert.strictEqual(nextBehaviorSubjectIfChanged(subject, 7), true);
        assert.strictEqual(nextBehaviorSubjectIfChanged(subject, 7), false);
        assert.strictEqual(nextBehaviorSubjectIfChanged(subject, undefined), true);
        assert.deepStrictEqual(values, [undefined, 7, undefined]);
    });

    it('reuses resource images by URI, removes stale entries, and invalidates after load', () => {
        const images: FakeImage[] = [];
        const cache = new ResourceImageCache(() => {
            const image = createFakeImage();
            images.push(image);
            return image as unknown as HTMLImageElement;
        });
        let invalidations = 0;
        const resourceA = { name: 'steel', imageUri: 'steel-a.png' } as any;

        cache.sync([resourceA], () => invalidations++);
        cache.sync([resourceA], () => invalidations++);
        assert.strictEqual(images.length, 1);
        assert.strictEqual(cache.getLoaded('steel'), undefined);

        images[0].complete = true;
        images[0].naturalWidth = 24;
        images[0].onload?.();
        assert.strictEqual(invalidations, 1);
        assert.strictEqual(cache.getLoaded('steel'), images[0] as unknown as HTMLImageElement);

        cache.sync([{ ...resourceA, imageUri: 'steel-b.png' }], () => invalidations++);
        assert.strictEqual(images.length, 2);
        assert.strictEqual(images[0].onload, null);
        assert.strictEqual(images[0].onerror, null);
        assert.strictEqual(invalidations, 1);

        cache.sync([], () => invalidations++);
        assert.strictEqual(cache.getLoaded('steel'), undefined);
        assert.strictEqual(images[1].onload, null);
        assert.strictEqual(images[1].onerror, null);

        cache.sync([resourceA], () => invalidations++);
        cache.clear();
        assert.strictEqual(cache.getLoaded('steel'), undefined);
        assert.strictEqual(images[2].onload, null);
        assert.strictEqual(images[2].onerror, null);
    });

    it('coalesces ViewPoint state emissions while publishing immediate render invalidations', () => {
        const previousDocument = (global as any).document;
        const previousRequestAnimationFrame = (global as any).requestAnimationFrame;
        const previousCancelAnimationFrame = (global as any).cancelAnimationFrame;
        const callbacks = new Map<number, FrameRequestCallback>();
        let nextHandle = 0;

        try {
            (global as any).document = { body: new EventTarget() };
            (global as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
                const handle = ++nextHandle;
                callbacks.set(handle, callback);
                return handle;
            };
            (global as any).cancelAnimationFrame = (handle: number) => callbacks.delete(handle);

            const { ViewPoint } = require('../../webviewsrc/worldmap/viewpoint') as typeof import('../../webviewsrc/worldmap/viewpoint');
            const canvas = new EventTarget() as EventTarget & { width: number; height: number };
            canvas.width = 800;
            canvas.height = 600;
            const viewPoint = new ViewPoint(canvas as unknown as HTMLCanvasElement, {
                worldMap: { width: 1024, height: 512 },
            } as any, 40, { x: 0, y: 0, scale: 1 });
            const states: { x: number; y: number; scale: number }[] = [];
            let invalidations = 0;
            viewPoint.observable$.subscribe(value => states.push(value));
            viewPoint.changed$.subscribe(() => invalidations++);

            canvas.dispatchEvent(createWheelEvent(-1, 100, 100));
            canvas.dispatchEvent(createWheelEvent(-1, 100, 100));
            canvas.dispatchEvent(createWheelEvent(-1, 100, 100));

            assert.strictEqual(invalidations, 3);
            assert.strictEqual(states.length, 1);
            assert.strictEqual(callbacks.size, 1);

            const callback = callbacks.values().next().value as FrameRequestCallback;
            callbacks.clear();
            callback(0);
            assert.strictEqual(states.length, 2);
            assert.strictEqual(states[1].scale, 4);

            canvas.dispatchEvent(createWheelEvent(1, 100, 100));
            assert.strictEqual(callbacks.size, 1);
            viewPoint.dispose();
            assert.strictEqual(callbacks.size, 0);
            assert.strictEqual(states.length, 2);
        } finally {
            (global as any).document = previousDocument;
            (global as any).requestAnimationFrame = previousRequestAnimationFrame;
            (global as any).cancelAnimationFrame = previousCancelAnimationFrame;
            delete require.cache[require.resolve('../../webviewsrc/worldmap/viewpoint')];
        }
    });
});

describe('world map webview indexes', () => {
    const previousAcquireVsCodeApi = (global as any).acquireVsCodeApi;
    const previousWindow = (global as any).window;

    beforeEach(() => {
        (global as any).acquireVsCodeApi = () => ({
            postMessage: () => undefined,
            getState: () => ({}),
            setState: () => undefined,
        });
        (global as any).window = new EventTarget();
    });

    afterEach(() => {
        (global as any).acquireVsCodeApi = previousAcquireVsCodeApi;
        (global as any).window = previousWindow;
        delete require.cache[require.resolve('../../webviewsrc/util/vscode')];
        delete require.cache[require.resolve('../../webviewsrc/worldmap/loader')];
    });

    it('uses spatial candidates while preserving exact cover-zone matching', () => {
        const { FEWorldMapClass } = require('../../webviewsrc/worldmap/loader') as typeof import('../../webviewsrc/worldmap/loader');
        const first = createProvince(1, 101, { x: 0, y: 0, w: 300, h: 300 }, [{ x: 0, y: 0, w: 50, h: 50 }]);
        const second = createProvince(2, 102, { x: 200, y: 200, w: 20, h: 20 }, [{ x: 200, y: 200, w: 20, h: 20 }]);
        const distant = createProvince(3, 103, { x: 400, y: 400, w: 20, h: 20 }, [{ x: 400, y: 400, w: 20, h: 20 }]);
        distant.coverZones.some = () => {
            throw new Error('A distant province should not be checked.');
        };
        const worldMap = new FEWorldMapClass(createWorldMap([undefined, first, second, distant]));

        assert.strictEqual(worldMap.getProvinceByPosition(20, 20)?.id, 1);
        assert.strictEqual(worldMap.getProvinceByPosition(205, 205)?.id, 2);
        assert.strictEqual(worldMap.getProvinceByPosition(130, 130), undefined);
        assert.strictEqual(worldMap.getProvinceByPosition(-1, 20), undefined);
    });

    it('indexes both sides of provinces that cross the horizontal map seam', () => {
        const { FEWorldMapClass } = require('../../webviewsrc/worldmap/loader') as typeof import('../../webviewsrc/worldmap/loader');
        const province = createProvince(1, 101,
            { x: 500, y: 10, w: 24, h: 10 },
            [{ x: 500, y: 10, w: 12, h: 10 }, { x: 0, y: 10, w: 12, h: 10 }]);
        const worldMap = new FEWorldMapClass(createWorldMap([undefined, province]));

        assert.strictEqual(worldMap.getProvinceByPosition(505, 15)?.id, 1);
        assert.strictEqual(worldMap.getProvinceByPosition(5, 15)?.id, 1);
    });

    it('indexes warning sources with stable order and deduplication', () => {
        const { FEWorldMapClass } = require('../../webviewsrc/worldmap/loader') as typeof import('../../webviewsrc/worldmap/loader');
        const province = createProvince(1, 101, { x: 0, y: 0, w: 10, h: 10 }, [{ x: 0, y: 0, w: 10, h: 10 }]);
        const warnings = [
            createWarning('province and state', [{ type: 'province', id: 1, color: 101 }, { type: 'state', id: 2 }]),
            createWarning('province color', [{ type: 'province', id: null, color: 101 }]),
            createWarning('state', [{ type: 'state', id: 2 }]),
            createWarning('strategic region', [{ type: 'strategicregion', id: 3 }]),
            createWarning('supply area', [{ type: 'supplyarea', id: 4 }]),
            createWarning('river', [{ type: 'river', index: 7 }]),
        ];
        const worldMap = new FEWorldMapClass(createWorldMap([undefined, province], { warnings }));
        const state = { id: 2 } as any;
        const strategicRegion = { id: 3 } as any;
        const supplyArea = { id: 4 } as any;

        assert.deepStrictEqual(
            worldMap.getProvinceWarnings(province, state, strategicRegion, supplyArea),
            ['province and state', 'province color', 'state', 'strategic region', 'supply area'],
        );
        assert.deepStrictEqual(worldMap.getStateWarnings(state, supplyArea), ['province and state', 'state', 'supply area']);
        assert.deepStrictEqual(worldMap.getStrategicRegionWarnings(strategicRegion), ['strategic region']);
        assert.deepStrictEqual(worldMap.getSupplyAreaWarnings(supplyArea), ['supply area']);
        assert.deepStrictEqual(worldMap.getRiverWarnings(7), ['river']);
    });

    it('indexes countries by tag while preserving the first matching country', () => {
        const { FEWorldMapClass } = require('../../webviewsrc/worldmap/loader') as typeof import('../../webviewsrc/worldmap/loader');
        const first = { tag: 'AAA', color: 0x010203 };
        const duplicate = { tag: 'AAA', color: 0x040506 };
        const worldMap = new FEWorldMapClass(createWorldMap([], {
            countries: [first, duplicate],
            countriesCount: 2,
        }));

        assert.strictEqual(worldMap.getCountryByTag('AAA'), first);
        assert.strictEqual(worldMap.getCountryByTag('BBB'), undefined);
        assert.strictEqual(worldMap.getCountryByTag(undefined), undefined);
    });
});

function createWheelEvent(deltaY: number, pageX: number, pageY: number): Event {
    return Object.assign(new Event('wheel'), { deltaY, pageX, pageY });
}

interface FakeImage {
    complete: boolean;
    naturalWidth: number;
    onerror: (() => void) | null;
    onload: (() => void) | null;
    src: string;
}

function createFakeImage(): FakeImage {
    return {
        complete: false,
        naturalWidth: 0,
        onerror: null,
        onload: null,
        src: '',
    };
}

function createProvince(id: number, color: number, boundingBox: any, coverZones: any[]): any {
    return {
        id,
        color,
        type: 'land',
        coastal: false,
        terrain: 'plains',
        continent: 1,
        boundingBox,
        coverZones,
        centerOfMass: { x: boundingBox.x, y: boundingBox.y },
        edges: [],
    };
}

function createWarning(text: string, source: any[]): any {
    return { text, source, relatedFiles: [] };
}

function createWorldMap(provinces: any[], overrides: Record<string, unknown> = {}): any {
    return {
        width: 512,
        height: 512,
        provinces,
        states: [],
        countries: [],
        warnings: [],
        continents: [],
        strategicRegions: [],
        supplyAreas: [],
        terrains: [],
        railways: [],
        supplyNodes: [],
        resources: [],
        rivers: [],
        conditionExprs: [],
        bookmarks: [],
        provincesCount: provinces.length,
        statesCount: 0,
        countriesCount: 0,
        strategicRegionsCount: 0,
        supplyAreasCount: 0,
        badProvincesCount: 0,
        badStatesCount: 0,
        badStrategicRegionsCount: 0,
        badSupplyAreasCount: 0,
        railwaysCount: 0,
        supplyNodesCount: 0,
        ...overrides,
    };
}
