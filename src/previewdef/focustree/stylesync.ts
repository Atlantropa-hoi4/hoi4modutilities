import type { FocusTreeStyleBase, FocusTreeStyleSync } from './webviewupdate';

/**
 * Dynamic focus tree styles travel as keyed class rules plus one raw block. The host records in a
 * ledger exactly what it posted, so later messages carry only changed and new rules on the
 * webview's confirmed stylesheet base. A webview without that base, a changed raw block, or enough
 * superseded rule bodies receive the whole stylesheet instead, rebuilt from the latest rules only.
 * Rules are never dropped: cached scenes, templates, inlays, and shared icons keep theirs.
 */

/** Serializes class rules in the format of `StyleTable.toStyleContent`. */
export function serializeFocusTreeStyleRules(rules: Iterable<readonly [key: string, content: string]>): string {
    let css = '';
    for (const [key, content] of rules) {
        css += `.${key} { ${content.replace(/^\s+/gm, '')} }\n`;
    }
    return css;
}

export interface FocusTreeStyleLedgerOptions {
    createBaseId?: () => string;
    /** Superseded rule characters the webview may hold before a change compacts its stylesheet. */
    compactionMinChars?: number;
    /** Superseded characters relative to live characters that compaction also waits for. */
    compactionRatio?: number;
}

export interface FocusTreeStyleLedgerState extends FocusTreeStyleBase {
    delivered: boolean;
    ruleCount: number;
    liveChars: number;
    supersededChars: number;
}

const defaultCompactionMinChars = 2 * 1024 * 1024;
const defaultCompactionRatio = 0.5;

function createDefaultStyleBaseId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class FocusTreeStyleLedger {
    private readonly createBaseId: () => string;
    private readonly compactionMinChars: number;
    private readonly compactionRatio: number;
    private baseId: string;
    private version = 0;
    private delivered = false;
    private currentRules: ReadonlyMap<string, string> = new Map();
    private rawCss = '';
    private liveChars = 0;
    private supersededChars = 0;

    constructor(options: FocusTreeStyleLedgerOptions = {}) {
        this.createBaseId = options.createBaseId ?? createDefaultStyleBaseId;
        this.compactionMinChars = options.compactionMinChars ?? defaultCompactionMinChars;
        this.compactionRatio = options.compactionRatio ?? defaultCompactionRatio;
        this.baseId = this.createBaseId();
    }

    /** Every rule the webview holds, latest content per key, in cascade order. Never mutated. */
    public get rules(): ReadonlyMap<string, string> {
        return this.currentRules;
    }

    public get rawStyleCss(): string {
        return this.rawCss;
    }

    public get state(): FocusTreeStyleLedgerState {
        return {
            baseId: this.baseId,
            version: this.version,
            delivered: this.delivered,
            ruleCount: this.currentRules.size,
            liveChars: this.liveChars,
            supersededChars: this.supersededChars,
        };
    }

    /** A new webview document replaces the session's content, so no rule is recorded any more. */
    public clear(): void {
        this.currentRules = new Map();
        this.rawCss = '';
        this.liveChars = 0;
        this.supersededChars = 0;
        this.invalidateDelivery();
    }

    /** The webview lost its stylesheet, e.g. it reloaded; the next sync sends every recorded rule. */
    public invalidateDelivery(): void {
        this.delivered = false;
        this.baseId = this.createBaseId();
        this.version = 0;
    }

    /**
     * Records rules the webview receives next and returns what to post: nothing when it holds them
     * already, a delta of changed and new rules on its confirmed base, or the whole stylesheet. A
     * changed rule moves to the end, like the later rule it becomes in the webview's cascade.
     * `rawCss` replaces the raw block when given.
     */
    public sync(rules: Iterable<readonly [string, string]>, rawCss?: string): FocusTreeStyleSync | undefined {
        let next: Map<string, string> | undefined;
        const changed = new Map<string, string>();
        for (const [key, content] of rules) {
            const current = (next ?? this.currentRules).get(key);
            if (current === content) {
                continue;
            }
            next ??= new Map(this.currentRules);
            if (current !== undefined) {
                next.delete(key);
                this.liveChars -= current.length;
                this.supersededChars += current.length;
            }
            next.set(key, content);
            this.liveChars += content.length;
            changed.delete(key);
            changed.set(key, content);
        }
        if (next) {
            this.currentRules = next;
        }

        const rawChanged = rawCss !== undefined && rawCss !== this.rawCss;
        if (rawChanged) {
            this.liveChars += rawCss.length - this.rawCss.length;
            this.supersededChars += this.rawCss.length;
            this.rawCss = rawCss;
        }
        if (changed.size === 0 && !rawChanged && this.delivered) {
            return undefined;
        }
        // Raw records can lose selectors, which only a whole stylesheet removes.
        if (!this.delivered || rawChanged || this.shouldCompact()) {
            return this.createFullSync();
        }

        const baseVersion = this.version;
        this.version += 1;
        return {
            kind: 'delta',
            baseId: this.baseId,
            baseVersion,
            version: this.version,
            css: serializeFocusTreeStyleRules(changed),
        };
    }

    /** The whole stylesheet, e.g. for a webview that could not apply a delta. */
    public resync(): FocusTreeStyleSync {
        return this.createFullSync();
    }

    private createFullSync(): FocusTreeStyleSync {
        this.version += 1;
        this.delivered = true;
        this.supersededChars = 0;
        const css = serializeFocusTreeStyleRules(this.currentRules);
        return {
            kind: 'full',
            baseId: this.baseId,
            version: this.version,
            css: this.rawCss ? `${css}${this.rawCss}\n` : css,
        };
    }

    private shouldCompact(): boolean {
        return this.supersededChars >= this.compactionMinChars
            && this.supersededChars >= this.liveChars * this.compactionRatio;
    }
}

/** Where the webview keeps its dynamic stylesheet. */
export interface FocusTreeStyleTarget {
    /** Replaces the whole dynamic stylesheet. */
    replace(css: string): void;
    /** Adds rules after the current ones; each replaces any earlier rule of its selector. */
    append(css: string): void;
}

/**
 * The webview end of style syncs. A full sync replaces the stylesheet and starts its base; a delta
 * applies only on the base version it names. Any other delta means a sync went missing, so the
 * webview asks for a whole stylesheet once and drops deltas until it arrives.
 */
export class FocusTreeStyleReceiver {
    private base: FocusTreeStyleBase | undefined;
    private awaitingResync = false;

    constructor(
        private readonly target: FocusTreeStyleTarget,
        private readonly requestResync: () => void,
    ) {}

    public get current(): FocusTreeStyleBase | undefined {
        return this.base && { ...this.base };
    }

    public get isAwaitingResync(): boolean {
        return this.awaitingResync;
    }

    /** Returns false when a delta does not fit the held stylesheet. */
    public apply(sync: FocusTreeStyleSync | undefined): boolean {
        if (!sync) {
            return true;
        }
        if (sync.kind === 'full') {
            this.target.replace(sync.css);
            this.base = { baseId: sync.baseId, version: sync.version };
            this.awaitingResync = false;
            return true;
        }
        if (!this.awaitingResync
            && this.base?.baseId === sync.baseId
            && this.base.version === sync.baseVersion) {
            this.target.append(sync.css);
            this.base = { baseId: sync.baseId, version: sync.version };
            return true;
        }
        if (!this.awaitingResync) {
            this.awaitingResync = true;
            this.requestResync();
        }
        return false;
    }
}
