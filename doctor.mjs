#!/usr/bin/env node
import{PipMCPGatewayClient}from'./lib/index.mjs';
import{pathToFileURL}from'node:url';
export async function discover({env=process.env,fetchImpl}={}){const connectorId="zoho-crm";if(connectorId==='custom-api'&&!env.PIPMCP_INTEGRATION_ID)throw new Error('Set PIPMCP_INTEGRATION_ID to your reviewed, published custom API. Draft imports have no callable tool inventory.');const client=new PipMCPGatewayClient({apiKey:env.PIPMCP_API_KEY,...(fetchImpl?{fetchImpl}:{})});return client.getTools(connectorId,{integrationId:env.PIPMCP_INTEGRATION_ID,connectionId:env.PIPMCP_CONNECTION_ID});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{console.log(JSON.stringify(await discover(),null,2));}catch(error){console.error(JSON.stringify({ok:false,error:{code:error.code??'setup_required',message:error.message}}));process.exitCode=1;}
