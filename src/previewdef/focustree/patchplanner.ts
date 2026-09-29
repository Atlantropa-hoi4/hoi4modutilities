import { FocusTreeRenderBaseState } from "./contentbuilder";
import { createFocusTreeRenderUpdate, FocusTreeRenderCache } from "./renderpayloadpatch";
import { FocusTreePatchPlan } from "./runtime";

export class FocusTreePatchPlanner {
    public async plan(
        previousCache: FocusTreeRenderCache | undefined,
        baseState: FocusTreeRenderBaseState,
        isCancelled?: () => boolean,
    ): Promise<FocusTreePatchPlan> {
        const updatePlan = await createFocusTreeRenderUpdate(previousCache, baseState, isCancelled);
        if (updatePlan.kind === 'full') {
            return { kind: 'full', prepared: updatePlan.prepared };
        }

        return {
            kind: 'partial',
            update: updatePlan.update,
            cache: updatePlan.cache,
            changedTreeCount: updatePlan.changedTreeCount,
            changedFocusCount: updatePlan.changedFocusCount,
            changedInlayCount: updatePlan.changedInlayCount,
        };
    }
}
