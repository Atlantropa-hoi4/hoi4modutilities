import { Node, parseHoi4File } from './hoiparser';
import { childNodes, readScalar } from './rawblock';

export type WorkspaceLoggingProfile = 'events' | 'ideas' | 'decisions' | 'focuses';

export interface WorkspaceLoggingResult {
    text: string;
    inserted: number;
    updated: number;
}

interface TextEdit {
    start: number;
    end: number;
    text: string;
}

interface LoggingEdits {
    edits: TextEdit[];
    inserted: number;
    updated: number;
}

const eventNodeNames = new Set(['country_event', 'state_event', 'unit_leader_event']);
const focusNodeNames = new Set(['focus', 'shared_focus', 'joint_focus']);
const decisionEffectNames = ['cancel_effect', 'complete_effect', 'remove_effect', 'timeout_effect'] as const;
const ideaCategoryScalars = new Set([
    'law',
    'use_list_view',
    'designer',
    'character_slot',
    'slot',
    'type',
    'cost',
    'removal_cost',
    'ledger',
    'default',
]);
const decisionTargetKeys = new Set([
    'targets',
    'target_array',
    'target_trigger',
    'target_root_trigger',
]);

export function getWorkspaceLoggingProfile(filePath: string): WorkspaceLoggingProfile | undefined {
    const normalized = `/${filePath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()}`;
    if (!normalized.endsWith('.txt')) {
        return undefined;
    }
    if (normalized.includes('/events/')) {
        return 'events';
    }
    if (normalized.includes('/common/ideas/')) {
        return 'ideas';
    }
    if (normalized.includes('/common/decisions/') && !normalized.includes('/common/decisions/categories/')) {
        return 'decisions';
    }
    if (normalized.includes('/common/national_focus/')) {
        return 'focuses';
    }
    return undefined;
}

export function updateWorkspaceLogging(
    text: string,
    filePath: string,
    profile: WorkspaceLoggingProfile | undefined = getWorkspaceLoggingProfile(filePath),
): WorkspaceLoggingResult {
    if (!profile) {
        return { text, inserted: 0, updated: 0 };
    }

    const root = parseHoi4File(text, `${filePath}: `);
    const loggingEdits: LoggingEdits = { edits: [], inserted: 0, updated: 0 };
    switch (profile) {
        case 'events':
            updateEvents(root, text, loggingEdits);
            break;
        case 'ideas':
            updateIdeas(root, text, loggingEdits);
            break;
        case 'decisions':
            updateDecisions(root, text, loggingEdits);
            break;
        case 'focuses':
            updateFocuses(root, text, loggingEdits);
            break;
    }

    return {
        text: applyTextEdits(text, loggingEdits.edits),
        inserted: loggingEdits.inserted,
        updated: loggingEdits.updated,
    };
}

function updateEvents(root: Node, source: string, loggingEdits: LoggingEdits): void {
    for (const event of childNodes(root)) {
        const eventType = event.name?.toLowerCase();
        if ((!eventType || !eventNodeNames.has(eventType)) && eventType !== 'news_event') {
            continue;
        }

        const idNode = findChild(event, 'id');
        const eventId = idNode ? readNodeText(idNode) : undefined;
        if (!idNode || !eventId || hasDoNotLog(event, source)) {
            continue;
        }

        if (eventType === 'news_event') {
            ensureEventImmediate(event, idNode, eventId, source, loggingEdits);
            continue;
        }

        const options = findChildren(event, 'option');
        options.forEach((option, index) => {
            const nameNode = findChild(option, 'name');
            const optionName = nameNode ? readNodeText(nameNode) : undefined;
            // Scripted localisation such as `[GetSomeOptionName]` is not a stable identifier.
            // Kaiserreich's formatter uses the one-based option position for those entries.
            const optionKey = optionName && !/^\[.*\]$/.test(optionName) ? optionName : String(index + 1);
            synchronizeLog(
                option,
                `[GetLogInfo]: event ${eventId} option ${optionKey}`,
                value => isGeneratedEventLog(value) && /\boption\b/i.test(value),
                source,
                loggingEdits,
            );
        });

        // Hidden and scripted events can have no option. Logging at event entry is the only useful
        // equivalent in that case; events with options remain logged at the selected option.
        if (options.length === 0) {
            ensureEventImmediate(event, idNode, eventId, source, loggingEdits);
        }
    }
}

function ensureEventImmediate(
    event: Node,
    idNode: Node,
    eventId: string,
    source: string,
    loggingEdits: LoggingEdits,
): void {
    const immediate = findChild(event, 'immediate');
    const expected = `[GetLogInfo]: event ${eventId}`;
    if (immediate && Array.isArray(immediate.value)) {
        synchronizeLog(
            immediate,
            expected,
            value => isGeneratedEventLog(value) && !/\boption\b/i.test(value),
            source,
            loggingEdits,
        );
        return;
    }

    insertChild(
        event,
        `immediate = { log = ${quoteHoi4String(expected)} }`,
        source,
        loggingEdits,
        idNode,
    );
}

function updateIdeas(root: Node, source: string, loggingEdits: LoggingEdits): void {
    for (const ideasNode of findChildren(root, 'ideas')) {
        for (const category of childNodes(ideasNode)) {
            if (!category.name || !Array.isArray(category.value) || category.name.toLowerCase() === 'hidden_ideas') {
                continue;
            }

            for (const idea of childNodes(category)) {
                const ideaId = idea.name;
                if (
                    !ideaId
                    || !Array.isArray(idea.value)
                    || ideaCategoryScalars.has(ideaId.toLowerCase())
                    || hasHeaderDoNotLog(idea, source)
                ) {
                    continue;
                }

                const onAdd = findChild(idea, 'on_add');
                const addLog = `[GetLogRoot]: add idea ${ideaId}`;
                if (onAdd && Array.isArray(onAdd.value)) {
                    synchronizeLog(
                        onAdd,
                        addLog,
                        value => isGeneratedIdeaLog(value, 'add'),
                        source,
                        loggingEdits,
                    );
                } else {
                    insertChild(
                        idea,
                        `on_add = { log = ${quoteHoi4String(addLog)} }`,
                        source,
                        loggingEdits,
                    );
                }

                for (const onRemove of findChildren(idea, 'on_remove')) {
                    synchronizeLog(
                        onRemove,
                        `[GetLogRoot]: remove idea ${ideaId}`,
                        value => isGeneratedIdeaLog(value, 'remove'),
                        source,
                        loggingEdits,
                    );
                }
            }
        }
    }
}

function updateDecisions(root: Node, source: string, loggingEdits: LoggingEdits): void {
    for (const category of childNodes(root)) {
        if (!category.name || !Array.isArray(category.value)) {
            continue;
        }

        for (const decision of childNodes(category)) {
            const decisionId = decision.name;
            if (!decisionId || !Array.isArray(decision.value) || hasHeaderDoNotLog(decision, source)) {
                continue;
            }

            for (const effectName of decisionEffectNames) {
                const action = effectName.substring(0, effectName.length - '_effect'.length);
                for (const effect of findChildren(decision, effectName)) {
                    const prefix = getDecisionLogPrefix(decision, effect, action, source);
                    synchronizeLog(
                        effect,
                        `${prefix}: Decision ${action} ${decisionId}`,
                        value => isGeneratedDecisionLog(value, action),
                        source,
                        loggingEdits,
                    );
                }
            }
        }
    }
}

function updateFocuses(root: Node, source: string, loggingEdits: LoggingEdits): void {
    const focuses: Node[] = [];
    for (const node of childNodes(root)) {
        const nodeName = node.name?.toLowerCase();
        if (nodeName && focusNodeNames.has(nodeName) && Array.isArray(node.value)) {
            focuses.push(node);
        } else if (nodeName === 'focus_tree') {
            focuses.push(...childNodes(node).filter(child => {
                const childName = child.name?.toLowerCase();
                return childName !== undefined && focusNodeNames.has(childName) && Array.isArray(child.value);
            }));
        }
    }

    for (const focus of focuses) {
        if (hasHeaderDoNotLog(focus, source)) {
            continue;
        }
        const idNode = findChild(focus, 'id');
        const focusId = idNode ? readNodeText(idNode) : undefined;
        if (!focusId) {
            continue;
        }

        for (const selectEffect of findChildren(focus, 'select_effect')) {
            synchronizeLog(
                selectEffect,
                `[GetLogRoot]: Select Focus ${focusId}`,
                value => isGeneratedFocusLog(value, 'select'),
                source,
                loggingEdits,
            );
        }
        for (const completionReward of findChildren(focus, 'completion_reward')) {
            synchronizeLog(
                completionReward,
                `[GetLogRoot]: Focus Completed ${focusId}`,
                value => isGeneratedFocusLog(value, 'complete'),
                source,
                loggingEdits,
            );
        }
    }
}

function synchronizeLog(
    block: Node,
    expected: string,
    isGenerated: (value: string) => boolean,
    source: string,
    loggingEdits: LoggingEdits,
): void {
    if (!Array.isArray(block.value) || hasDoNotLog(block, source)) {
        return;
    }

    const logs = findChildren(block, 'log')
        .map(node => ({ node, value: readNodeText(node) }))
        .filter((entry): entry is { node: Node; value: string } => entry.value !== undefined);
    if (logs.some(entry => entry.value === expected)) {
        return;
    }

    const generated = logs.find(entry => isGenerated(entry.value));
    if (generated?.node.valueStartToken && generated.node.valueEndToken) {
        loggingEdits.edits.push({
            start: generated.node.valueStartToken.start,
            end: generated.node.valueEndToken.end,
            text: quoteHoi4String(expected),
        });
        loggingEdits.updated++;
        return;
    }

    insertChild(block, `log = ${quoteHoi4String(expected)}`, source, loggingEdits);
}

function insertChild(
    parent: Node,
    statement: string,
    source: string,
    loggingEdits: LoggingEdits,
    preferredAfter?: Node,
): void {
    const edit = createChildInsertion(parent, statement, source, preferredAfter);
    if (!edit) {
        return;
    }
    loggingEdits.edits.push(edit);
    loggingEdits.inserted++;
}

function createChildInsertion(parent: Node, statement: string, source: string, preferredAfter?: Node): TextEdit | undefined {
    const open = parent.valueStartToken;
    const close = parent.valueEndToken;
    if (!open || !close || open.value !== '{') {
        return undefined;
    }

    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const parentIndent = indentationAt(source, parent.nameToken?.start ?? open.start);
    const children = childNodes(parent).filter(child => child.nameToken);
    const firstMultilineChild = children.find(child => lineStart(source, child.nameToken!.start) > lineStart(source, open.start));
    const childIndent = firstMultilineChild
        ? indentationAt(source, firstMultilineChild.nameToken!.start)
        : `${parentIndent}\t`;

    if (preferredAfter?.valueEndToken) {
        const lineBreak = findLineBreak(source, preferredAfter.valueEndToken.end, close.start);
        if (lineBreak) {
            return {
                start: lineBreak.end,
                end: lineBreak.end,
                text: `${childIndent}${statement}${eol}`,
            };
        }
    }

    const firstChild = children[0];
    if (firstChild?.nameToken && lineStart(source, firstChild.nameToken.start) > lineStart(source, open.start)) {
        const position = lineStart(source, firstChild.nameToken.start);
        return { start: position, end: position, text: `${childIndent}${statement}${eol}` };
    }
    if (firstChild?.nameToken) {
        return {
            start: firstChild.nameToken.start,
            end: firstChild.nameToken.start,
            text: `${statement} `,
        };
    }

    if (lineStart(source, close.start) > lineStart(source, open.start)) {
        const position = lineStart(source, close.start);
        return { start: position, end: position, text: `${childIndent}${statement}${eol}` };
    }

    const needsLeadingSpace = close.start === open.end || !/\s/.test(source.charAt(close.start - 1));
    return {
        start: close.start,
        end: close.start,
        text: `${needsLeadingSpace ? ' ' : ''}${statement} `,
    };
}

function findChild(parent: Node, name: string): Node | undefined {
    const normalizedName = name.toLowerCase();
    return childNodes(parent).find(child => child.name?.toLowerCase() === normalizedName);
}

function findChildren(parent: Node, name: string): Node[] {
    const normalizedName = name.toLowerCase();
    return childNodes(parent).filter(child => child.name?.toLowerCase() === normalizedName);
}

function readNodeText(node: Node): string | undefined {
    const value = readScalar(node.value);
    return value === undefined ? undefined : String(value);
}

function getDecisionLogPrefix(decision: Node, effect: Node, action: string, source: string): string {
    const existing = findChildren(effect, 'log')
        .map(readNodeText)
        .find((value): value is string => value !== undefined && isGeneratedDecisionLog(value, action));
    if (existing) {
        if (/\[GetLogFrom\]|\[From\.GetName\]|\btarget\s*:/i.test(existing)) {
            return '[GetLogRoot][GetLogFrom]';
        }
        // Keep a generated log's established scope while updating its action or decision id.
        return '[GetLogRoot]';
    }
    return isTargetDecision(decision, source) ? '[GetLogRoot][GetLogFrom]' : '[GetLogRoot]';
}

function isTargetDecision(decision: Node, source: string): boolean {
    const hasExplicitTarget = childNodes(decision).some(child => {
        const name = child.name?.toLowerCase();
        if (!name) {
            return false;
        }
        if (decisionTargetKeys.has(name)) {
            return true;
        }
        if (name === 'state_target' || name === 'targets_dynamic') {
            return readScalar(child.value) !== false;
        }
        return false;
    });
    if (hasExplicitTarget || !decision.nameToken || !decision.valueEndToken) {
        return hasExplicitTarget;
    }
    return /\bFROM\b/i.test(source.substring(decision.nameToken.start, decision.valueEndToken.end));
}

function isGeneratedEventLog(value: string): boolean {
    return /\bevent\s+\S+/i.test(value)
        && (/\[GetLogInfo\]/i.test(value) || /\[GetDateText\]/i.test(value) || /KR_Event_Logging/i.test(value));
}

function isGeneratedIdeaLog(value: string, action: 'add' | 'remove'): boolean {
    return new RegExp(`\\b${action} idea\\b`, 'i').test(value)
        && (/\[GetLogRoot\]/i.test(value) || /\[GetDateText\]/i.test(value));
}

function isGeneratedDecisionLog(value: string, action: string): boolean {
    return new RegExp(`\\bDecision ${action}\\b`, 'i').test(value)
        && (/\[GetLogRoot\]/i.test(value) || /\[GetDateText\]/i.test(value));
}

function isGeneratedFocusLog(value: string, action: 'select' | 'complete'): boolean {
    if (!/\[GetLogRoot\]|\[GetDateText\]/i.test(value)) {
        return false;
    }
    return action === 'select'
        ? /\bSelect Focus\b/i.test(value)
        : /\bFocus(?: Completed)?\s+\S+/i.test(value) && !/\bSelect Focus\b/i.test(value);
}

function hasHeaderDoNotLog(node: Node, source: string): boolean {
    if (!node.nameToken || !node.valueStartToken) {
        return false;
    }
    const end = lineEnd(source, node.valueStartToken.end);
    return hasDoNotLogText(source.substring(node.nameToken.start, end));
}

function hasDoNotLog(node: Node, source: string): boolean {
    if (!node.nameToken || !node.valueEndToken) {
        return false;
    }
    return hasDoNotLogText(source.substring(node.nameToken.start, node.valueEndToken.end));
}

function hasDoNotLogText(text: string): boolean {
    return /#[^\r\n]*\bdonotlog\b/i.test(text);
}

function quoteHoi4String(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function indentationAt(source: string, offset: number): string {
    return source.substring(lineStart(source, offset), offset).match(/^[\t ]*/)?.[0] ?? '';
}

function lineStart(source: string, offset: number): number {
    const index = source.lastIndexOf('\n', Math.max(0, offset - 1));
    return index === -1 ? 0 : index + 1;
}

function lineEnd(source: string, offset: number): number {
    const index = source.indexOf('\n', offset);
    return index === -1 ? source.length : index + 1;
}

function findLineBreak(source: string, start: number, limit: number): { end: number } | undefined {
    const newline = source.indexOf('\n', start);
    if (newline === -1 || newline >= limit) {
        return undefined;
    }
    return { end: newline + 1 };
}

function applyTextEdits(source: string, edits: TextEdit[]): string {
    const sorted = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
    let result = source;
    let nextStart = source.length;
    for (const edit of sorted) {
        if (edit.start < 0 || edit.end < edit.start || edit.end > nextStart) {
            throw new Error('Workspace logging produced overlapping or invalid edits.');
        }
        result = result.substring(0, edit.start) + edit.text + result.substring(edit.end);
        nextStart = edit.start;
    }
    return result;
}
