import { runtime } from './runtime';
import { FocusScene } from './scene';
import { applyFocusEdgeVisualState, applyFocusNodeVisualState, bindFocusVisualState, setHoveredRelationFocusId } from './visualstate';

let sceneMaterializedListener: () => void = () => undefined;

export function setSceneMaterializedListener(listener: () => void): void {
    sceneMaterializedListener = listener;
}

export const focusScene = new FocusScene(runtime.focusToolbarHeight, {
    onNodeRendered: applyFocusNodeVisualState,
    onEdgeRendered: applyFocusEdgeVisualState,
    onNodesRemoved: focusIds => {
        if (runtime.hoveredRelationFocusId && focusIds.includes(runtime.hoveredRelationFocusId)) {
            setHoveredRelationFocusId(undefined);
        }
    },
    onMaterialized: () => sceneMaterializedListener(),
});

bindFocusVisualState(focusScene);
