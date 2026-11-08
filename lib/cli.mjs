#!/usr/bin/env node
import{PipMCPGatewayClient,apiBase}from'./client.mjs';import{startBridge}from'./bridge.mjs';
const argv=process.argv.slice(2);
if(argv[0]==='agents'&&argv[1]==='install'){
 try{const installer=await import('./agentkit/install.mjs');process.exitCode=await installer.main(argv.slice(2))??0;}catch(error){console.error(JSON.stringify({ok:false,error:{code:'agent_install_unavailable',message:error.code==='ERR_MODULE_NOT_FOUND'?'This gateway package has no bundled agent kit. Use the repository agent-installation guide.':error.message}}));process.exitCode=1;}
}else{
const args=argv,command=args[0]?.startsWith('--')?'serve':args.shift()??'help';
const options={};let offline=false,fixture=false;
try{
 while(args.length){const arg=args.shift();if(arg==='--offline')offline=true;else if(arg==='--fixture')fixture=true;else if(['--connector','--provider','--integration-id','--connection-id','--state-dir'].includes(arg)){const value=args.shift();if(!value||value.startsWith('--'))throw new Error('Missing option value.');options[{'--connector':'connectorId','--provider':'providerId','--integration-id':'integrationId','--connection-id':'connectionId','--state-dir':'stateDir'}[arg]]=value;}else if(arg==='--help'){options.help=true;}else throw new Error('Unknown gateway CLI option.');}
 if(command==='help'||options.help)console.log('PipMCP gateway: serve --connector ID [--integration-id ID --connection-id ID]; doctor [--offline]. Set PIPMCP_API_KEY (pmk_). No local provider execution or fallback.');
 else if(command==='doctor'){
  if(offline&&fixture)throw new Error('Choose offline or synthetic fixture doctor.');
  if(fixture)console.log(JSON.stringify({mode:'fixture',requiredCredential:'PIPMCP_API_KEY',authentication:'synthetic-not-tested',providerExecution:'not-tested',data:{connector_id:options.connectorId??options.providerId??'fixture-connector',definition:'synthetic-fixture',tools:[{name:'fixture_read',inputSchema:{type:'object',properties:{},additionalProperties:false},readOnly:true,approvalRequired:false}]}}));
  else if(offline)console.log(JSON.stringify({mode:'offline',apiOrigin:apiBase,requiredCredential:'PIPMCP_API_KEY',keyPresent:Boolean(process.env.PIPMCP_API_KEY),authentication:'not-tested',providerExecution:'not-tested'}));
  else{const client=new PipMCPGatewayClient();const connector=options.connectorId??options.providerId;const result=connector?await client.getTools(connector,{integrationId:options.integrationId,connectionId:options.connectionId}):await client.listConnectors();console.log(JSON.stringify({mode:'authenticated-discovery',data:result.data,providerExecution:'not-tested'},null,2));}
 }else if(command==='serve'){if(offline||fixture)throw new Error('--offline/--fixture are only available for doctor.');new PipMCPGatewayClient();startBridge(options);}
 else throw new Error('Use serve, doctor or help.');
}catch(error){console.error(JSON.stringify({ok:false,error:{code:error.code??'gateway_cli_error',message:error.message}}));process.exitCode=1;}

}
