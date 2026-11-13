import type { EffectTreeNode, EventGraphEdge, EventGraphNode } from '../src/previewdef/event/payload';
import { hashStyleContent } from '../src/util/styletable';

/** Graph traversal IDs and source offsets change after edits; retain a semantic selection instead. */
export function eventDetailsKeys(nodes: readonly EventGraphNode[], edges: readonly EventGraphEdge[],
    effectBlocks: readonly EffectTreeNode[][] = []): Map<string, string> {
    const events = new Map(nodes.filter(node => node.kind === 'event').map(node => [node.id, node]));
    const owners = new Map<string, string[]>();
    for (const edge of edges) {
        const owner = events.get(edge.from);
        if (edge.structural && owner) {
            const list = owners.get(edge.to) ?? [];
            list.push(JSON.stringify([owner.nav?.file ?? '', owner.eventId, owner.scope]));
            owners.set(edge.to, list);
        }
    }
    const identities = new Map<string, string>();
    const totals = new Map<string, number>();
    for (const node of nodes) {
        if (node.kind === 'unresolved') {
            continue;
        }
        const identity = JSON.stringify(node.kind === 'event'
            ? [node.kind, node.nav?.file ?? '', node.eventId, node.scope]
            : [node.kind, node.nav?.file ?? '', node.name.key, [...owners.get(node.id) ?? []].sort()]);
        identities.set(node.id, identity);
        totals.set(identity, (totals.get(identity) ?? 0) + 1);
    }
    const counts = new Map<string, number>();
    const result = new Map<string, string>();
    for (const node of nodes) {
        let identity = identities.get(node.id);
        if (identity === undefined) { continue; }
        // Repeated localisation keys can describe different choices. An insertion must never
        // reopen another choice merely because it inherited the old ordinal or effectsRef.
        if (node.kind === 'option' && totals.get(identity)! > 1) {
            identity += hashStyleContent(JSON.stringify([node.trigger, node.aiChanceScript, node.originalRecipientOnly,
                node.effectsRef === undefined ? [] : effectBlocks[node.effectsRef] ?? []]));
        }
        const occurrence = counts.get(identity) ?? 0;
        counts.set(identity, occurrence + 1);
        result.set(node.id, JSON.stringify([identity, occurrence]));
    }
    return result;
}
