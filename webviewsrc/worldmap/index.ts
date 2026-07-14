import { Loader } from './loader';
import { ViewPoint } from './viewpoint';
import { topBarHeight, TopBar } from './topbar';
import { getState, setState } from '../util/common';
import { Renderer } from './renderer';
import { fromEvent, Subscription } from 'rxjs';
import { WorldMapStateBatcher } from './statebatcher';

window.addEventListener('load', function initializeWorldMap() {
    const state = getState();
    const loader = new Loader();
    const mainCanvas = document.getElementById('main-canvas') as HTMLCanvasElement;
    const viewPoint = new ViewPoint(mainCanvas, loader, topBarHeight, state.viewPoint || { x: 0, y: -topBarHeight, scale: 1 });
    const topBar = new TopBar(mainCanvas, viewPoint, loader, state);
    const renderer = new Renderer(mainCanvas, viewPoint, loader, topBar);
    const stateBatcher = new WorldMapStateBatcher(setState);

    const subscriptions: Subscription[] = [
        fromEvent(mainCanvas, 'contextmenu').subscribe(event => event.preventDefault()),
        viewPoint.observable$.subscribe(setStateForKey(stateBatcher, 'viewPoint')),
        topBar.viewMode$.subscribe(setStateForKey(stateBatcher, 'viewMode')),
        topBar.colorSet$.subscribe(setStateForKey(stateBatcher, 'colorSet')),
        topBar.selectedProvinceId$.subscribe(setStateForKey(stateBatcher, 'selectedProvinceId')),
        topBar.selectedStateId$.subscribe(setStateForKey(stateBatcher, 'selectedStateId')),
        topBar.selectedStrategicRegionId$.subscribe(setStateForKey(stateBatcher, 'selectedStrategicRegionId')),
        topBar.warningFilter.selectedValues$.subscribe(setStateForKey(stateBatcher, 'warningFilter')),
        topBar.display.selectedValues$.subscribe(setStateForKey(stateBatcher, 'display')),
        topBar.conditions.selectedValues$.subscribe(setStateForKey(stateBatcher, 'selectedConditions')),
    ];

    window.addEventListener('pagehide', () => {
        stateBatcher.update('viewPoint', viewPoint.toJson());
        subscriptions.forEach(subscription => subscription.unsubscribe());
        renderer.dispose();
        topBar.dispose();
        viewPoint.dispose();
        loader.dispose();
        stateBatcher.dispose();
    }, { once: true });
}, { once: true });

function setStateForKey<T>(stateBatcher: WorldMapStateBatcher, key: string): (newValue: T) => void {
    return newValue => {
        stateBatcher.update(key, newValue);
    };
}
