import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export async function buildRustCompute(rootDir, distDir) {
    const manifest = path.join(rootDir, 'rust', 'hoi4-compute', 'Cargo.toml');
    await new Promise((resolve, reject) => {
        const child = spawn('cargo', ['build', '--manifest-path', manifest, '--target-dir', path.join(rootDir, 'rust', 'hoi4-compute', 'target'),
            '--release', '--target', 'wasm32-unknown-unknown', '--offline', '--locked'], {
            cwd: rootDir, stdio: 'inherit', shell: false,
        });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Rust compute build failed (${code}). Install Rust and the wasm32-unknown-unknown target.`)));
    });
    await fs.mkdir(distDir, { recursive: true });
    await fs.copyFile(
        path.join(rootDir, 'rust', 'hoi4-compute', 'target', 'wasm32-unknown-unknown', 'release', 'hoi4_compute.wasm'),
        path.join(distDir, 'hoi4_compute.wasm'),
    );
}

export function computeWorkerOptions(rootDir, distDir, production = true) {
    return {
        entryPoints: [path.join(rootDir, 'src', 'util', 'compute', 'worker.ts')],
        outfile: path.join(distDir, 'compute-worker.js'),
        bundle: true, platform: 'node', format: 'cjs', target: 'node20',
        sourcemap: 'linked', minify: production, legalComments: 'none',
    };
}

export async function buildCompute(rootDir) {
    const distDir = path.join(rootDir, 'dist');
    await buildRustCompute(rootDir, distDir);
    await build(computeWorkerOptions(rootDir, distDir));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    buildCompute(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
