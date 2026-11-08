import{promises as fs}from'node:fs';
import path from'node:path';
import os from'node:os';
import{createHash}from'node:crypto';
import{fileURLToPath,pathToFileURL}from'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
export async function main(argv=process.argv.slice(2),{home=os.homedir(),cwd=process.cwd(),stdout=process.stdout}={}){
 const opts={client:'codex',scope:'project',project:cwd,skills:[]};
 while(argv.length){const k=argv.shift();if(!['--client','--scope','--project','--skill'].includes(k))throw new Error('Unknown installer argument: '+k);const v=argv.shift();if(!v||v.startsWith('--'))throw new Error('Missing value for '+k);if(k==='--skill')opts.skills.push(v);else opts[k.slice(2)]=v;}
 if(!['codex','claude','grok'].includes(opts.client)||!['project','user'].includes(opts.scope))throw new Error('Use --client codex|claude|grok and --scope project|user');
 const manifest=JSON.parse(await fs.readFile(path.join(base,'manifest.json'),'utf8'));
 for(const[rel,digest]of Object.entries(manifest.files??{})){if(!/^skills\/[a-z0-9-]+\/(SKILL\.md|references\/[a-z0-9.-]+)$/.test(rel))throw new Error('Invalid agent asset path');if(createHash('sha256').update(await fs.readFile(path.join(base,rel))).digest('hex')!==digest)throw new Error('Agent asset checksum mismatch: '+rel);}
 const selected=manifest.skills.filter(s=>!opts.skills.length||opts.skills.includes(s.name));
 if(opts.skills.some(n=>!manifest.skills.some(s=>s.name===n)))throw new Error('Unknown skill');
 async function canonical(p){try{return await fs.realpath(p);}catch(e){if(e.code!=='ENOENT')throw e;return path.join(await canonical(path.dirname(p)),path.basename(p));}}
 const root=await canonical(path.resolve(opts.scope==='user'?home:opts.project));const target=path.join(root,opts.client==='codex'?'.agents':'.claude','skills');
 const pending=[];
 async function collect(from,to){for(const entry of await fs.readdir(from,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('Installer refuses source symlinks');const src=path.join(from,entry.name),dst=path.join(to,entry.name);if(entry.isDirectory())await collect(src,dst);else pending.push([dst,await fs.readFile(src)]);}}
 for(const skill of selected)await collect(path.join(base,'skills',skill.name),path.join(target,skill.name));
 // Inspect the entire path chain before writing; do not follow target symlinks.
 for(const [dest,bytes]of pending){let parent=dest;while(parent!==path.dirname(parent)){try{if((await fs.lstat(parent)).isSymbolicLink())throw new Error('Installer refuses target symlinks: '+parent);}catch(e){if(e.code!=='ENOENT')throw e;}parent=path.dirname(parent);}try{const old=await fs.readFile(dest);if(!old.equals(bytes))throw new Error('Existing file differs; installer will not overwrite: '+dest);}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const[dest,bytes]of pending){await fs.mkdir(path.dirname(dest),{recursive:true});try{await fs.writeFile(dest,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(!(await fs.readFile(dest)).equals(bytes))throw new Error('Existing file changed during installation: '+dest);}}
 const receipt={ok:true,client:opts.client,scope:opts.scope,directory:target,skills:selected.map(s=>s.name),credentialsWritten:false};stdout.write(JSON.stringify(receipt,null,2)+'\n');return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
