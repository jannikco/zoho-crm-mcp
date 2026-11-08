import type {McpServer} from '@modelcontextprotocol/server';
export type JsonValue = null | string | number | boolean | JsonValue[] | {[key:string]:JsonValue};
export interface GatewayEnvelope<T> {ok?:boolean; data:T; [key:string]:unknown}
export interface ConnectorSummary {id:string;name?:string;status:'not_configured'|'configured'|'integration_selection_required';definition?:string;integrations?:Array<{id:string;name?:string;connections?:Array<{id:string;name?:string}>}>}
export interface PublishedTool {name:string;title?:string;description?:string;inputSchema:Record<string,unknown>;readOnly:boolean;approvalRequired:boolean}
export interface ToolInventory {connector_id:string;integration_id?:string;connection_id?:string;definition?:string;tools:PublishedTool[]}
export interface CallReceipt {id:string;connector_id:string;status:'succeeded'|'failed'|'uncertain'|'confirmation_required'|'running'|'reserved';result?:unknown;error?:{code:string;message?:string;details?:unknown;suggested_action?:string;retryable?:boolean};approval_id?:string;replayed?:boolean;automatic_retry_allowed?:false;[key:string]:unknown}
export interface TransportOptions {apiKey?:string;fetchImpl?:typeof fetch;timeoutMs?:number;maxBytes?:number}
export interface Selection {integrationId?:string;connectionId?:string;signal?:AbortSignal}
export interface GatewayCallBody {tool:string;arguments:Record<string,JsonValue>;integration_id?:string;connection_id?:string}
export class PipMCPGatewayError extends Error {constructor(code:string,message:string,details?:{status?:number;retryAfter?:string|null;result?:unknown});code:string;status:number;retryAfter:string|null;result:unknown;request?:{idempotencyKey:string;connectorId:string;callId:string|null;state:string}}
export const apiBase:'https://pipmcp.com/api/v1';
export class PipMCPGatewayClient {
 constructor(options?:TransportOptions);
 listConnectors(options?:{signal?:AbortSignal}):Promise<GatewayEnvelope<ConnectorSummary[]>>;
 getTools(connectorId:string,selection?:Selection):Promise<GatewayEnvelope<ToolInventory>>;
 call(connectorId:string,body:GatewayCallBody,options:{idempotencyKey:string;signal?:AbortSignal}):Promise<GatewayEnvelope<CallReceipt>>;
 callTool(connectorId:string,tool:string,args:Record<string,JsonValue>,options:Selection&{idempotencyKey:string}):Promise<GatewayEnvelope<CallReceipt>>;
 getCall(connectorId:string,callId:string,options?:{signal?:AbortSignal}):Promise<GatewayEnvelope<CallReceipt>>;
}
export {PipMCPGatewayClient as PipMCPClient};
export interface GatewayRequestMeta {[key:string]:unknown;'pipmcp/idempotencyKey'?:string;'pipmcp/approved'?:boolean;'pipmcp/resumeCall'?:boolean}
export interface BridgeReceipt {idempotencyKey:string;connectorId:string;operation:string;freshWriteRequiresExplicitKey?:boolean;resumeRequires?:string}
export interface GatewayBridgeOptions extends TransportOptions {connectorId?:string;providerId?:string;integrationId?:string;connectionId?:string;stateDir?:string;client?:PipMCPGatewayClient}
export class GatewayBridge {constructor(options:GatewayBridgeOptions);listTools():Promise<Array<{name:string;title?:string;description?:string;inputSchema:Record<string,unknown>;annotations:Record<string,unknown>}>>;callTool(name:string,args?:Record<string,JsonValue>,meta?:GatewayRequestMeta):Promise<GatewayEnvelope<CallReceipt>&{bridge:BridgeReceipt}>}
export function canonicalArguments(value:unknown):JsonValue;
export function createBridge(options:GatewayBridgeOptions&{gateway?:GatewayBridge}):McpServer;
export function startBridge(options:GatewayBridgeOptions):{close():Promise<void>};
