/** Fixed-origin authenticated PipMCP connector gateway. No local provider transport. */
export const apiBase='https://pipmcp.com/api/v1';
export class PipMCPGatewayError extends Error{constructor(code,message,{status=0,retryAfter=null,result=null}={}){super(message);this.name='PipMCPGatewayError';Object.assign(this,{code,status,retryAfter,result});}}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const token=value=>typeof value==='string'&&/^pmk_[A-Za-z0-9_-]{8,200}$/.test(value);
const identifier=(value,name)=>{if(typeof value!=='string'||!value||value.length>200||['.','..'].includes(value)||/[\r\n]/.test(value))throw new TypeError(`A valid ${name} is required.`);return encodeURIComponent(value);};
const idempotency=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{16,200}$/.test(value);
const validReceipt=result=>{if(!object(result?.data)||typeof result.data.id!=='string'||!result.data.id||!['succeeded','failed','uncertain','confirmation_required','running','reserved'].includes(result.data.status))throw new PipMCPGatewayError('invalid_response','Gateway returned an invalid durable call receipt. Inspect the request before retrying.');return result;};
const explanations={UNAUTHENTICATED:'The PipMCP API key was rejected. Create or select a valid pmk_ account key.',INSUFFICIENT_SCOPE:'The PipMCP key does not grant this operation. Review its connector scopes.',MEMBER_PERMISSION_DENIED:'The signed-in member lacks the required permission.',ROLE_UNAVAILABLE:'The member role is unavailable for this operation.',CONNECTOR_NOT_CONFIGURED:'This connector is not configured in the PipMCP workspace. Connect it in PipMCP first.',INTEGRATION_SELECTION_REQUIRED:'Choose an explicit configured integration_id for this connector.',CONNECTION_SELECTION_REQUIRED:'Choose an explicit authorized connection_id for this integration.',CONNECTION_UNAVAILABLE:'The selected connection is unavailable. Review it in PipMCP.',CONNECTOR_NOT_FOUND:'This connector is unavailable on the gateway.',TOOL_UNAVAILABLE:'The tool is not published or authorized for this connection. Refresh discovery.',IDEMPOTENCY_CONFLICT:'This idempotency key already belongs to different arguments. Inspect the original call; use a fresh key only for a deliberate new intent.',CALL_NOT_FOUND:'The call receipt is unavailable for this key and connection.',RESULT_EXPIRED:'The retained result expired. The gateway will not rerun it automatically.',RATE_LIMITED:'PipMCP rate-limited the request. Respect Retry-After; no retry was attempted.'};
function scrub(value,key){if(typeof value==='string')return value.split(key).join('[redacted]');if(Array.isArray(value))return value.map(v=>scrub(v,key));if(object(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,scrub(v,key)]));return value;}
async function readBody(response,signal,maxBytes){
 if(Number(response.headers.get('content-length'))>maxBytes)throw new PipMCPGatewayError('response_too_large','Gateway response exceeds the size limit.');
 if(!response.body)throw new PipMCPGatewayError('invalid_response','Gateway response was empty.');const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
 const read=()=>new Promise((resolve,reject)=>{const abort=()=>reject(new PipMCPGatewayError('timeout','Gateway response timed out; inspect any call receipt before retrying.'));if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
 try{for(;;){const {done,value}=await read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw new PipMCPGatewayError('response_too_large','Gateway response exceeds the size limit.');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();try{return JSON.parse(text);}catch{throw new PipMCPGatewayError('invalid_response','Gateway returned invalid JSON.');}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export class PipMCPGatewayClient{
 #key;#fetch;#timeout;#maxBytes;
 constructor({apiKey=process.env.PIPMCP_API_KEY,fetchImpl=globalThis.fetch,timeoutMs=30000,maxBytes=4000000,baseUrl}={}){
  if(!token(apiKey))throw new PipMCPGatewayError('api_key_required','Set PIPMCP_API_KEY to a valid pmk_ account API key before any gateway operation.');
  if(baseUrl!==undefined&&baseUrl!==apiBase)throw new PipMCPGatewayError('fixed_origin','The gateway client only connects to https://pipmcp.com/api/v1.');
  if(typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>10000000)throw new TypeError('Invalid gateway transport limits.');
  this.#key=apiKey;this.#fetch=fetchImpl;this.#timeout=timeoutMs;this.#maxBytes=maxBytes;
 }
 async #request(method,path,{query={},body,signal,idempotencyKey}={}){
  const u=new URL(apiBase+path);for(const[name,value]of Object.entries(query))if(value!==undefined){identifier(value,name);u.searchParams.set(name,value);}
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),this.#timeout),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const headers={Authorization:`Bearer ${this.#key}`,Accept:'application/json'};if(body!==undefined)headers['Content-Type']='application/json';if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
  try{
   const response=await this.#fetch(u.href,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:combined,redirect:'error'});
   if(response.redirected||response.status>=300&&response.status<400)throw new PipMCPGatewayError('redirect_refused','Gateway redirects are refused to protect the account key.');
   const result=scrub(await readBody(response,combined,this.#maxBytes),this.#key);
   if(!response.ok||result?.ok===false||result?.error){const code=typeof result?.error?.code==='string'?result.error.code:`HTTP_${response.status}`;throw new PipMCPGatewayError(code,explanations[code]??`PipMCP refused the gateway request (HTTP ${response.status}). Inspect the account and original call receipt before retrying.`,{status:response.status,retryAfter:response.headers.get('retry-after'),result});}
   if(!object(result)||!Object.hasOwn(result,'data'))throw new PipMCPGatewayError('invalid_response','Gateway returned an invalid response envelope.');return result;
  }catch(error){if(error instanceof PipMCPGatewayError)throw error;throw new PipMCPGatewayError(combined.aborted?'timeout':'transport_error',combined.aborted?'Gateway request timed out. Inspect the original call receipt before retrying.':'Gateway transport failed. Inspect any original call receipt before repeating an uncertain operation.');}
  finally{clearTimeout(deadline);}
 }
 listConnectors(options={}){return this.#request('GET','/connectors',options);}
 getTools(connectorId,{integrationId,connectionId,signal}={}){return this.#request('GET',`/connectors/${identifier(connectorId,'connector id')}/tools`,{query:{integration_id:integrationId,connection_id:connectionId},signal});}
 call(connectorId,body,{idempotencyKey,signal}={}){
  if(!idempotency(idempotencyKey))throw new TypeError('Provide an explicit16–200 character idempotencyKey containing letters, digits, . _ : or -.');
  if(!object(body)||typeof body.tool!=='string'||!body.tool||!object(body.arguments))throw new TypeError('A canonical tool name and object arguments are required.');
  for(const key of Object.keys(body))if(!['tool','arguments','connection_id','integration_id'].includes(key))throw new TypeError('Unknown gateway call field.');
  for(const key of['connection_id','integration_id'])if(body[key]!==undefined)identifier(body[key],key);
  return this.#request('POST',`/connectors/${identifier(connectorId,'connector id')}/calls`,{body,idempotencyKey,signal}).then(validReceipt);
 }
 callTool(connectorId,tool,args={},options={}){const{integrationId,connectionId,...transport}=options;return this.call(connectorId,{tool,arguments:args,...(integrationId?{integration_id:integrationId}:{}),...(connectionId?{connection_id:connectionId}:{})},transport);}
 getCall(connectorId,callId,{signal}={}){return this.#request('GET',`/connectors/${identifier(connectorId,'connector id')}/calls/${identifier(callId,'call id')}`,{signal}).then(validReceipt);}
}
export {PipMCPGatewayClient as PipMCPClient};
