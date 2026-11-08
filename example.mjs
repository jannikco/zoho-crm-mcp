#!/usr/bin/env node
import{discover}from'./doctor.mjs';
if(!process.argv.includes('--live'))console.log(JSON.stringify({mode:'offline-plan',connectorId:"zoho-crm",credential:'PIPMCP_API_KEY',api:'https://pipmcp.com/api/v1',authentication:'not-tested',providerExecution:'not-run',next:'Configure your hosted integration and run npm run doctor with an authorized key.'},null,2));
else try{console.log(JSON.stringify(await discover(),null,2));}catch(error){console.error(JSON.stringify({ok:false,error:{code:error.code??'setup_required',message:error.message}}));process.exitCode=1;}
