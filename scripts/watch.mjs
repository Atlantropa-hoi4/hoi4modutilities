#!/usr/bin/env node
import { spawn } from 'node:child_process';

const commandRunner = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const watchScripts = [
    'watch:typecheck:extension',
    'watch:typecheck:webview',
    'watch:bundle',
];

const children = watchScripts.map(script => spawn(commandRunner, ['run', script], {
    stdio: 'inherit',
    shell: false,
}));

let exiting = false;

function shutdown(code = 0) {
    if (exiting) {
        return;
    }

    exiting = true;
    for (const child of children) {
        if (!child.killed) {
            child.kill();
        }
    }
    process.exit(code);
}

for (const child of children) {
    child.on('exit', code => {
        if (!exiting && code && code !== 0) {
            shutdown(code);
        }
    });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
