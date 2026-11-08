import {readFile} from 'node:fs/promises';
import {startServer} from '../lib/runtime/index.js';
import {envFor} from './samples.mjs';
const connector=JSON.parse(await readFile(new URL('../connector.json',import.meta.url),'utf8'));
startServer(connector,{env:envFor(connector),fetch:async()=>new Response(JSON.stringify({fixture:true}),{headers:{'content-type':'application/json'}})});
