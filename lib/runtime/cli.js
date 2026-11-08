#!/usr/bin/env node
/** Stdout is exclusively MCP JSON-RPC; configuration failures go to stderr. */
import { readFile } from 'node:fs/promises';
import { startServer } from './index.js';
const file = process.argv[2];
try {
    if (!file)
        throw new Error('A connector manifest JSON path is required.');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    startServer(manifest);
}
catch {
    console.error('Cannot start connector: inspect its manifest and local configuration.');
    process.exitCode = 1;
}
