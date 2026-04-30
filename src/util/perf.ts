export type PerfTags = Record<string, string | number | boolean | undefined>;

export interface PerfEntry {
    label: string;
    tags: PerfTags;
    durationMs: number;
    ok: boolean;
    timestamp: number;
    error?: string;
}

export interface PerfCounter {
    label: string;
    tags: PerfTags;
    count: number;
}

const maxEntries = 200;
const entries: PerfEntry[] = [];
const counters = new Map<string, PerfCounter>();

export function isPerfTraceEnabled(): boolean {
    return process.env.HOI4MU_PERF_TRACE === '1';
}

export async function measureAsync<T>(
    label: string,
    tags: PerfTags,
    fn: () => Promise<T>,
): Promise<T> {
    const startedAt = Date.now();
    try {
        const result = await fn();
        recordPerf(label, Date.now() - startedAt, tags, true);
        return result;
    } catch (error) {
        recordPerf(label, Date.now() - startedAt, tags, false, error);
        throw error;
    }
}

export function measureSync<T>(
    label: string,
    tags: PerfTags,
    fn: () => T,
): T {
    const startedAt = Date.now();
    try {
        const result = fn();
        recordPerf(label, Date.now() - startedAt, tags, true);
        return result;
    } catch (error) {
        recordPerf(label, Date.now() - startedAt, tags, false, error);
        throw error;
    }
}

export function recordPerf(
    label: string,
    durationMs: number,
    tags: PerfTags = {},
    ok: boolean = true,
    error?: unknown,
): void {
    const entry: PerfEntry = {
        label,
        tags: normalizeTags(tags),
        durationMs,
        ok,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
    };
    entries.push(entry);
    if (entries.length > maxEntries) {
        entries.splice(0, entries.length - maxEntries);
    }

    if (isPerfTraceEnabled()) {
        try {
            const { debug } = require('./debug') as typeof import('./debug');
            debug('[perf]', entry);
        } catch {
            // Keep perf collection usable in low-level unit tests without the VS Code runtime.
        }
    }
}

export function incrementPerfCounter(label: string, tags: PerfTags = {}, delta: number = 1): void {
    const normalizedTags = normalizeTags(tags);
    const key = JSON.stringify([label, normalizedTags]);
    const existing = counters.get(key);
    if (existing) {
        existing.count += delta;
        return;
    }

    counters.set(key, {
        label,
        tags: normalizedTags,
        count: delta,
    });
}

export function getPerfSnapshot(options?: { limit?: number }): { entries: PerfEntry[]; counters: PerfCounter[] } {
    const limit = options?.limit ?? 50;
    return {
        entries: entries.slice(Math.max(0, entries.length - limit)),
        counters: Array.from(counters.values()),
    };
}

export function resetPerfMetrics(): void {
    entries.length = 0;
    counters.clear();
}

function normalizeTags(tags: PerfTags): PerfTags {
    return Object.fromEntries(
        Object.entries(tags)
            .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
            .sort(([left], [right]) => left.localeCompare(right)),
    );
}
