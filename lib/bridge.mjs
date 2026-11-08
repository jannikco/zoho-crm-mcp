/** MCP schemas and execution come only from the authenticated hosted gateway. */
import{McpServer}from'@modelcontextprotocol/server';import{serveStdio}from'@modelcontextprotocol/server/stdio';
import{createHash,randomUUID}from'node:crypto';import{mkdir,readFile,writeFile,rename,unlink,open}from'node:fs/promises';import{join}from'node:path';import{homedir}from'node:os';
import{PipMCPGatewayClient,PipMCPGatewayError}from'./client.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keyPattern=/^[A-Za-z0-9._:-]{16,200}$/;
export function canonicalArguments(value,depth=0){
 if(depth>30)throw new TypeError('Arguments exceed the JSON nesting limit.');
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(v=>canonicalArguments(v,depth+1));
 if(object(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalArguments(value[k],depth+1)]));
 throw new TypeError('Tool arguments must contain JSON values only.');
}
const hash=value=>createHash('sha256').update(value).digest('hex');
export class GatewayBridge{
 #client;#keyFingerprint;#connectorId;#integrationId;#connectionId;#tools=new Map();#discovered=false;#stateDir;
 constructor({apiKey=process.env.PIPMCP_API_KEY,connectorId,providerId,integrationId,connectionId,stateDir=join(homedir(),'.local','share','pipmcp-gateway'),client,...transport}={}){
  if(typeof(connectorId??providerId)!=='string'||!(connectorId??providerId))throw new TypeError('Choose a connectorId for hosted tool discovery.');
  this.#client=client??new PipMCPGatewayClient({apiKey,...transport});
  if(typeof apiKey!=='string'||!/^pmk_[A-Za-z0-9_-]{8,200}$/.test(apiKey))throw new PipMCPGatewayError('api_key_required','Set PIPMCP_API_KEY before bridge discovery or execution.');
  this.#keyFingerprint=hash(apiKey);this.#connectorId=connectorId??providerId;this.#integrationId=integrationId;this.#connectionId=connectionId;this.#stateDir=stateDir;
 }
 async listTools(){
  const response=await this.#client.getTools(this.#connectorId,{integrationId:this.#integrationId,connectionId:this.#connectionId}),data=response.data;
  if(!object(data)||data.connector_id!==this.#connectorId||!Array.isArray(data.tools))throw new PipMCPGatewayError('invalid_inventory','Gateway returned no valid connector tool inventory.');
  if(this.#integrationId&&data.integration_id!==this.#integrationId||this.#connectionId&&data.connection_id!==this.#connectionId)throw new PipMCPGatewayError('selection_mismatch','Gateway returned a different integration or connection than explicitly selected.');
  const names=new Set();for(const tool of data.tools){if(typeof tool?.name!=='string'||!tool.name||!object(tool.inputSchema)||names.has(tool.name))throw new PipMCPGatewayError('invalid_inventory','Gateway returned an invalid or duplicate tool definition.');names.add(tool.name);}
  this.#integrationId=data.integration_id??this.#integrationId;this.#connectionId=data.connection_id??this.#connectionId;this.#tools=new Map(data.tools.map(t=>[t.name,t]));this.#discovered=true;
  return data.tools.map(tool=>({name:tool.name,...(tool.title?{title:tool.title}:{}),...(tool.description?{description:tool.description}:{}),inputSchema:tool.inputSchema,annotations:{readOnlyHint:tool.readOnly===true,destructiveHint:tool.readOnly!==true,openWorldHint:true}}));
 }
 async #journal(fn){
  await mkdir(this.#stateDir,{recursive:true,mode:0o700});const identity=hash(JSON.stringify([this.#keyFingerprint,this.#connectorId,this.#integrationId??null,this.#connectionId??null]));const file=join(this.#stateDir,identity+'.json');let lock;
  try{lock=await open(file+'.lock','wx',0o600);}catch{throw new PipMCPGatewayError('intent_locked','Another write owns this private gateway journal. Inspect active/stale intent before continuing.');}
  try{let state;try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}state??={schemaVersion:1,owner:'pipmcp-gateway',identity,intents:{},defaults:{}};
   if(state.owner!=='pipmcp-gateway'||state.identity!==identity||!object(state.intents)||!object(state.defaults))throw new PipMCPGatewayError('journal_mismatch','The gateway journal is not a recognized account/connection ledger.');
   const save=async()=>{const temp=file+'.tmp-'+randomUUID();try{await writeFile(temp,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}};return await fn(state,save);
  }finally{await lock.close();await unlink(file+'.lock').catch(()=>{});}
 }
 async callTool(name,args={},meta={}){
  if(!object(args)||!object(meta))throw new TypeError('Tool arguments and request metadata must be objects.');
  if(!this.#discovered)await this.listTools();const tool=this.#tools.get(name);if(!tool)throw new PipMCPGatewayError('TOOL_UNAVAILABLE','This canonical tool is not in the gateway inventory for the selected connection.');
  const canonical=JSON.stringify(canonicalArguments(args));if(Buffer.byteLength(canonical)>1000000)throw new TypeError('Tool arguments exceed the1MB bridge limit.');
  const explicit=meta['pipmcp/idempotencyKey'];if(explicit!==undefined&&(typeof explicit!=='string'||!keyPattern.test(explicit)))throw new TypeError('pipmcp/idempotencyKey must contain16–200 allowed characters.');
  const write=tool.readOnly!==true||tool.approvalRequired===true;
  if(write&&meta['pipmcp/approved']===false)throw new PipMCPGatewayError('approval_required','The caller explicitly held this write for review. Hosted policies remain authoritative.');
  const body={tool:name,arguments:args,...(this.#connectionId?{connection_id:this.#connectionId}:{}),...(this.#integrationId?{integration_id:this.#integrationId}:{})};
  const send=key=>this.#client.call(this.#connectorId,body,{idempotencyKey:key});
  if(!write){const key=explicit??randomUUID();const result=await send(key);return {...result,bridge:{idempotencyKey:key,connectorId:this.#connectorId,operation:'hosted-gateway-call'}};}
  const fingerprint=hash(JSON.stringify([name,canonical]));
  return this.#journal(async(state,save)=>{
   const key=explicit??state.defaults[fingerprint]??randomUUID(),previous=state.intents[key];
   if(previous&&previous.fingerprint!==fingerprint)throw new PipMCPGatewayError('IDEMPOTENCY_CONFLICT','This stable key is already bound to different tool arguments on this connection.');
   if(previous){
    if(meta['pipmcp/resumeCall']===true||previous.state==='confirmation_required'&&meta['pipmcp/resumeCall']!==false){
     if(!explicit&&previous.state!=='confirmation_required')throw new PipMCPGatewayError('original_key_required','Explicit resume requires the original pipmcp/idempotencyKey.');
     if(['uncertain','pending'].includes(previous.state))throw new PipMCPGatewayError('execution_uncertain','This intent has an unknown outcome. Inspect the hosted account before reconciliation; it will not be reposted.');
     // Resume is a single explicit request with the same key/body. It never approves
     // the hosted action or creates a fresh key to consume another call's approval.
    }else{
     if(!previous.callId)throw new PipMCPGatewayError(previous.state==='rejected'?'previous_intent_rejected':'execution_uncertain','A prior intent is held. Inspect it before explicitly choosing a new request key; no repeat was sent.');
     const result=await this.#client.getCall(this.#connectorId,previous.callId);return {...result,bridge:{idempotencyKey:key,connectorId:this.#connectorId,operation:'existing-call-receipt',freshWriteRequiresExplicitKey:true,resumeRequires:'original key + pipmcp/resumeCall after dashboard review'}};
    }
   }
   const intent=previous??{fingerprint,createdAt:new Date().toISOString()};intent.state='pending';state.intents[key]=intent;state.defaults[fingerprint]=key;await save();
   try{
    const result=await send(key),receipt=result.data;
    if(!object(receipt)||typeof receipt.id!=='string'||!['succeeded','failed','uncertain','confirmation_required','running','reserved'].includes(receipt.status))throw new PipMCPGatewayError('invalid_response','Gateway returned no valid durable call receipt.');
    intent.callId=receipt.id;intent.state=receipt.status;await save();return {...result,bridge:{idempotencyKey:key,connectorId:this.#connectorId,operation:previous?'explicit-same-intent-resume':'new-hosted-intent'}};
   }catch(error){intent.state=error.status>=400&&error.status<500?'rejected':'uncertain';await save();error.request={idempotencyKey:key,connectorId:this.#connectorId,callId:intent.callId??null,state:intent.state};throw error;}
  });
 }
}
export function createBridge(options={}){
 const gateway=options.gateway??new GatewayBridge(options);const server=new McpServer({name:'pipmcp-gateway',version:'1.0.0'},{capabilities:{tools:{}}});
 server.server.setRequestHandler('tools/list',async()=>({tools:await gateway.listTools()}));
 server.server.setRequestHandler('tools/call',async request=>{try{const result=await gateway.callTool(request.params.name,request.params.arguments??{},request.params._meta??{});return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:['failed','uncertain'].includes(result.data?.status)};}catch(error){return {content:[{type:'text',text:JSON.stringify({ok:false,error:{code:error.code??'gateway_error',message:error instanceof PipMCPGatewayError?error.message:'Gateway bridge rejected invalid input or a transport operation.',...(error.request?{request:error.request}:{})}})}],isError:true};}});return server;
}
export function startBridge(options={}){return serveStdio(()=>createBridge(options));}
