#!/usr/bin/env node
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const target = process.argv[2] ?? 'all';

const dirsByTarget = {
    all: ['dist', 'static', 'out'],
    build: ['dist', 'static'],
    out: ['out'],
};

const dirs = dirsByTarget[target];
if (!dirs) {
    console.error(`Unknown clean target: ${target}. Valid targets: ${Object.keys(dirsByTarget).join(', ')}`);
    process.exit(1);
}

async function rm(dir) {
    const absolute = path.join(rootDir, dir);
    await fs.rm(absolute, { recursive: true, force: true });
}

await Promise.all(dirs.map(rm));
console.log(`Cleaned: ${dirs.join(', ')}`);
