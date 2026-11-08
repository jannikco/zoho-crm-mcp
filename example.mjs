/** Offline inspection by default; explicit --call uses your provider credentials. */
import {readFile} from 'node:fs/promises';
import {runTool} from './lib/runtime/index.js';
import {resolveCredential} from './local-auth/index.mjs';
const connector=JSON.parse(await readFile(new URL('./connector.json',import.meta.url),'utf8'));
const index=process.argv.indexOf('--call');
if(index<0)console.log(JSON.stringify({provider:connector.name,mode:'local',tools:connector.tools.map(t=>({name:t.name,description:t.description,readOnly:t.readOnly,example:t.sampleArguments})),workflow:connector.workflow},null,2));
else {try{const result=await runTool(connector,process.argv[index+1],JSON.parse(process.argv[index+2]??'{}'),{credentialResolver:manifest=>resolveCredential(manifest)});console.log(JSON.stringify(result,null,2));}catch(error){console.error(JSON.stringify({code:error.code??'invalid_input',status:error.status??0}));process.exitCode=1;}}
