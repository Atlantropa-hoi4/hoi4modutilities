import type { Mio } from './schema';
import type { MioPositionEdit } from './editcommon';

/** Returns an undo operation for a speculative position update. */
export function applyMioLocalPositions(mio: Mio, edits: readonly MioPositionEdit[]): () => void {
    const previous = edits.map(edit => {
        const trait = mio.traits[edit.traitId];
        return { trait, x: trait?.x, y: trait?.y };
    });
    for (const edit of edits) {
        const trait = mio.traits[edit.traitId];
        if (trait) {
            trait.x = Math.round(edit.x);
            trait.y = Math.round(edit.y);
        }
    }
    return () => {
        for (const entry of previous) {
            if (entry.trait) {
                entry.trait.x = entry.x!;
                entry.trait.y = entry.y!;
            }
        }
    };
}
