import type { EventGraphNode } from '../src/previewdef/event/payload';

/** Search both source identifiers and translated labels, independently of the label toggle. */
export function matchesQuery(node: EventGraphNode, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (normalized === '') {
        return false;
    }
    const fields = node.kind === 'option' ? [node.name.key, node.name.text]
        : [node.eventId, node.title?.key ?? '', node.title?.text ?? ''];
    return fields.some(field => field.toLowerCase().includes(normalized));
}
