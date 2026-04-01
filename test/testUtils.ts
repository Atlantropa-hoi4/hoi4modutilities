import * as fs from 'fs';
import * as path from 'path';

export function getFixturePath(...segments: string[]): string {
    return path.resolve(__dirname, '..', '..', 'test', 'fixtures', ...segments);
}

export function readFixture(...segments: string[]): string {
    return fs.readFileSync(getFixturePath(...segments), 'utf8');
}

export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number = 15000, intervalMs: number = 100): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timed out after ${timeoutMs}ms`);
}
