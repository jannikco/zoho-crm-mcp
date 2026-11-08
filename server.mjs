#!/usr/bin/env node
import{PipMCPGatewayClient,startBridge}from'./lib/index.mjs';
try{new PipMCPGatewayClient();const connectorId="zoho-crm";if(connectorId==='custom-api'&&!process.env.PIPMCP_INTEGRATION_ID)throw new Error('Set PIPMCP_INTEGRATION_ID to the reviewed, published private API integration.');startBridge({connectorId,integrationId:process.env.PIPMCP_INTEGRATION_ID,connectionId:process.env.PIPMCP_CONNECTION_ID});}catch(error){console.error(JSON.stringify({ok:false,error:{code:error.code??'setup_required',message:error.message}}));process.exitCode=1;}
