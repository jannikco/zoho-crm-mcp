#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {startServer} from './lib/runtime/index.js';
import {resolveCredential} from './local-auth/index.mjs';
const index=process.argv.indexOf('--manifest');
const file=index<0?new URL('./connector.json',import.meta.url):process.argv[index+1];
const connector=JSON.parse(await readFile(file,'utf8'));
startServer(connector,{credentialResolver:manifest=>resolveCredential(manifest)});
