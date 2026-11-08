/** Direct-provider MCP runtime. Uses the official v2 SDK factory for modern and legacy stdio. */
import { McpServer } from '@modelcontextprotocol/server';
export type JsonSchema = Record<string, unknown>;
export interface AuthConfig {
    type: 'none' | 'bearer' | 'header' | 'basic' | 'query' | 'oauth-access-token' | 'oauth';
    env?: string;
    header?: string;
    name?: string;
    prefix?: string;
    queryParam?: string;
    usernameEnv?: string;
    passwordEnv?: string;
    extraHeaders?: Record<string, {
        env: string;
    }>;
    extraQuery?: Record<string, {
        env: string;
    }>;
    [key: string]: unknown;
}
export interface ToolBinding {
    name: string;
    description: string;
    method: string;
    path: string;
    readOnly: boolean;
    inputSchema: JsonSchema;
    bindings?: {
        path?: string[];
        query?: Record<string, string>;
        body?: Record<string, string>;
    };
    body?: Record<string, unknown>;
    bodyMode?: 'json-null';
    requestHeaderBindings?: Record<string, string>;
    contentType?: string;
    headers?: Record<string, string>;
    idempotencyHeader?: string;
    pagination?: {
        type: 'cursor' | 'header' | 'link';
        cursorInput?: string;
        nextCursorPath?: string;
        headerName?: string;
        hasMorePath?: string;
    };
    provenance?: string[];
    [key: string]: unknown;
}
export interface ConnectorManifest {
    id: string;
    name: string;
    version: string;
    baseUrl: string;
    hostVariables?: string[];
    allowedHostSuffixes?: string[];
    auth: AuthConfig;
    headers?: Record<string, string>;
    tools: ToolBinding[];
    workflow?: unknown;
    provenance?: string[];
    [key: string]: unknown;
}
export interface RuntimeOptions {
    env?: Record<string, string | undefined>;
    fetch?: typeof fetch;
    credentialResolver?: (manifest: ConnectorManifest) => Promise<{
        accessToken?: string;
    } | null | undefined>;
    allowWrites?: boolean;
    stateDir?: string;
    accountId?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export declare class ConnectorError extends Error {
    code: string;
    status: number;
    requestId: string | null;
    retryAfter: string | null;
    constructor(code: string, status?: number, requestId?: string | null, retryAfter?: string | null);
}
export declare function inputSchemaFor(tool: ToolBinding): JsonSchema;
export declare function runTool(manifest: ConnectorManifest, toolName: string, input: unknown, options?: RuntimeOptions): Promise<{
    ok: boolean;
    provider: string;
    tool: string;
    data: unknown;
    pagination: {
        pagesFetched: number;
        nextArguments: Record<string, unknown> | null;
        complete: boolean;
        truncated: boolean;
    };
    execution: string;
}>;
export declare function createServer(manifest: ConnectorManifest, options?: RuntimeOptions): McpServer;
export declare function startServer(manifest: ConnectorManifest, options?: RuntimeOptions): import("@modelcontextprotocol/server/stdio").StdioServerHandle;
