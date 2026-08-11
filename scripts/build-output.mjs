import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function cleanBuildOutputDirectories(rootDir) {
    await Promise.all([
        fs.rm(path.join(rootDir, 'dist'), { recursive: true, force: true }),
        fs.rm(path.join(rootDir, 'static'), { recursive: true, force: true }),
    ]);
}
