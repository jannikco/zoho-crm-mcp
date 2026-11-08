/** Direct-provider MCP runtime. Uses the official v2 SDK factory for modern and legacy stdio. */
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export class ConnectorError extends Error {
    code;
    status;
    requestId;
    retryAfter;
    constructor(code, status = 0, requestId = null, retryAfter = null) {
        super(code.replace(/_/g, ' '));
        this.code = code;
        this.status = status;
        this.requestId = requestId;
        this.retryAfter = retryAfter;
        this.name = 'ConnectorError';
    }
}
const digest = (value) => createHash('sha256').update(value).digest('hex');
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function object(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function safeName(value) { if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value))
    throw new ConnectorError('invalid_manifest'); }
function get(value, field) { if (object(value) && Object.hasOwn(value, field))
    return value[field]; return field.split('.').reduce((item, key) => object(item) ? item[key] : undefined, value); }
function set(value, field, input) { const keys = field.split('.'); let target = value; for (const key of keys.slice(0, -1)) {
    if (forbidden.has(key))
        throw new ConnectorError('invalid_binding');
    if (!object(target[key]))
        target[key] = {};
    target = target[key];
} const final = keys.at(-1); if (forbidden.has(final))
    throw new ConnectorError('invalid_binding'); target[final] = input; }
function needed(env, key) { if (!key || !env[key] || /[\r\n]/.test(env[key]))
    throw new ConnectorError('credential_missing'); return env[key]; }
function publicHostname(hostname) { return hostname.includes('.') && !/^\d+(?:\.\d+){3}$/.test(hostname) && !/[:\[\]]/.test(hostname) && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(hostname) && /^[A-Za-z0-9.-]+$/.test(hostname); }
function endpoint(manifest, env) {
    const expanded = manifest.baseUrl.replace(/\{([A-Z][A-Z0-9_]*)\}/g, (_, key) => {
        const value = needed(env, key);
        if (manifest.hostVariables?.includes(key) ? !publicHostname(value) : !/^[A-Za-z0-9-]+$/.test(value))
            throw new ConnectorError('invalid_host_configuration');
        return value;
    });
    let url;
    try {
        url = new URL(expanded);
    }
    catch {
        throw new ConnectorError('invalid_base_url');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !publicHostname(url.hostname))
        throw new ConnectorError('invalid_base_url');
    if (manifest.allowedHostSuffixes && !manifest.allowedHostSuffixes.some(suffix => url.hostname === suffix || url.hostname.endsWith('.' + suffix)))
        throw new ConnectorError('invalid_host_configuration');
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url;
}
export function inputSchemaFor(tool) {
    const schema = structuredClone(tool.inputSchema);
    schema.type = 'object';
    schema.additionalProperties = false;
    const properties = object(schema.properties) ? schema.properties : {};
    if (tool.readOnly === false)
        properties._approval = { type: 'object', additionalProperties: false, properties: { approved: { const: true }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['approved', 'idempotencyKey'] };
    if (tool.pagination && tool.readOnly)
        properties._pagination = { type: 'object', additionalProperties: false, properties: { maxPages: { type: 'integer', minimum: 1, maximum: 10 } } };
    schema.properties = properties;
    return schema;
}
async function validatedArgs(tool, args) {
    const validator = fromJsonSchema(inputSchemaFor(tool));
    const result = await validator['~standard'].validate(args);
    if (result.issues || !object(result.value))
        throw new ConnectorError('invalid_arguments');
    return result.value;
}
function safeHeaders(values) { const result = {}; for (const [key, value] of Object.entries(values ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key) || /[\r\n]/.test(value) || ['host', 'cookie', 'proxy-authorization'].includes(key.toLowerCase()))
        throw new ConnectorError('invalid_manifest_headers');
    result[key] = value;
} return result; }
async function authFor(manifest, env, options) {
    const auth = manifest.auth, headers = {}, query = {}, secrets = [];
    const secret = (key) => { const value = needed(env, key); secrets.push(value); return value; };
    if (auth.type === 'bearer' || auth.type === 'header' || auth.type === 'oauth-access-token' || auth.type === 'oauth') {
        let token;
        if ((auth.type === 'oauth-access-token' || auth.type === 'oauth') && (!auth.env || !env[auth.env]) && options.credentialResolver) {
            let stored;
            try {
                stored = await options.credentialResolver(manifest);
            }
            catch {
                throw new ConnectorError('credential_unavailable');
            }
            if (!stored?.accessToken || /[\r\n]/.test(stored.accessToken))
                throw new ConnectorError('credential_missing');
            token = stored.accessToken;
            secrets.push(token);
        }
        else
            token = secret(auth.env);
        const header = auth.header ?? auth.name ?? 'Authorization';
        headers[header] = (auth.prefix ?? (auth.type === 'header' ? '' : 'Bearer ')) + token;
    }
    else if (auth.type === 'basic') {
        headers.Authorization = 'Basic ' + Buffer.from(secret(auth.usernameEnv) + ':' + secret(auth.passwordEnv)).toString('base64');
        secrets.push(headers.Authorization.slice(6));
    }
    else if (auth.type === 'query') {
        const param = auth.queryParam ?? auth.name;
        if (!param)
            throw new ConnectorError('invalid_auth_configuration');
        query[param] = secret(auth.env);
    }
    else if (auth.type !== 'none')
        throw new ConnectorError('invalid_auth_configuration');
    for (const [name, value] of Object.entries(auth.extraHeaders ?? {}))
        headers[name] = secret(value.env);
    for (const [name, value] of Object.entries(auth.extraQuery ?? {}))
        query[name] = secret(value.env);
    return { headers: safeHeaders(headers), query, secrets };
}
function appendQuery(params, key, value) { if (value === null || value === undefined)
    return; if (Array.isArray(value)) {
    params.set(key, value.map(String).join(','));
    return;
} if (object(value))
    params.set(key, JSON.stringify(value));
else
    params.set(key, String(value)); }
function requestFor(manifest, tool, args, base, auth, approval) {
    let resource = tool.path;
    if ((resource !== '' && !resource.startsWith('/')) || resource.startsWith('//') || resource.includes('?') || resource.includes('#') || /(?:^|\/)\.\.?(?:\/|$)/.test(resource))
        throw new ConnectorError('invalid_tool_path');
    resource = resource.replace(/\{([^}]+)\}/g, (_, name) => { if (!tool.bindings?.path?.includes(name))
        throw new ConnectorError('invalid_path_binding'); const value = args[name]; if (!['string', 'number'].includes(typeof value) || value === '' || value === '.' || value === '..')
        throw new ConnectorError('invalid_arguments'); return encodeURIComponent(String(value)); });
    const url = new URL(base.href.replace(/\/$/, '') + resource);
    for (const [arg, target] of Object.entries(tool.bindings?.query ?? {}))
        appendQuery(url.searchParams, target, args[arg]);
    for (const [key, value] of Object.entries(auth.query))
        url.searchParams.set(key, value);
    const headers = { Accept: 'application/json', ...safeHeaders(manifest.headers), ...safeHeaders(tool.headers), ...auth.headers };
    let body;
    if (!['GET', 'HEAD'].includes(tool.method.toUpperCase())) {
        const payload = structuredClone(tool.body ?? {});
        for (const [arg, target] of Object.entries(tool.bindings?.body ?? {}))
            if (args[arg] !== undefined) {
                if (target === '') {
                    if (!object(args[arg]))
                        throw new ConnectorError('invalid_arguments');
                    for (const [key, value] of Object.entries(args[arg])) {
                        if (forbidden.has(key))
                            throw new ConnectorError('invalid_arguments');
                        payload[key] = value;
                    }
                }
                else
                    set(payload, target, args[arg]);
            }
        const type = tool.contentType ?? 'application/json';
        headers['Content-Type'] = type;
        if (type === 'application/x-www-form-urlencoded') {
            const form = new URLSearchParams();
            for (const [key, value] of Object.entries(payload))
                appendQuery(form, key, value);
            body = form.toString();
        }
        else if (type === 'application/json')
            body = JSON.stringify(tool.bodyMode === 'json-null' ? null : payload);
        else
            throw new ConnectorError('unsupported_content_type');
    }
    for (const [arg, header] of Object.entries(tool.requestHeaderBindings ?? {})) {
        if (args[arg] === undefined)
            continue;
        if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(header) || ['authorization', 'host', 'cookie', 'proxy-authorization', 'content-type', 'accept'].includes(header.toLowerCase()) || Object.keys(auth.headers).some(key => key.toLowerCase() === header.toLowerCase()) || typeof args[arg] !== 'string' || /[\r\n]/.test(args[arg]))
            throw new ConnectorError('invalid_request_header_binding');
        headers[header] = args[arg];
    }
    if (approval && tool.idempotencyHeader) {
        if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(tool.idempotencyHeader) || ['authorization', 'host', 'cookie', 'proxy-authorization'].includes(tool.idempotencyHeader.toLowerCase()) || Object.keys(auth.headers).some(key => key.toLowerCase() === tool.idempotencyHeader.toLowerCase()))
            throw new ConnectorError('invalid_request_header_binding');
        headers[tool.idempotencyHeader] = String(approval.idempotencyKey);
    }
    return { url, init: { method: tool.method.toUpperCase(), headers, body, redirect: 'error' } };
}
function requestId(response, secrets) { const value = response.headers.get('x-request-id'); return value && /^[A-Za-z0-9._:-]{1,150}$/.test(value) ? secrets.some(secret => secret.length >= 4 && value.includes(secret)) ? '[REDACTED]' : value : null; }
function retryAfter(response) { const value = response.headers.get('retry-after'); if (!value)
    return null; if (/^\d{1,9}$/.test(value))
    return value; const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toUTCString() : null; }
function redact(value, secrets) { if (typeof value === 'string') {
    let result = value;
    for (const secret of secrets)
        if (secret.length >= 4)
            result = result.split(secret).join('[REDACTED]');
    return result;
} if (Array.isArray(value))
    return value.map(item => redact(item, secrets)); if (object(value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /(?:access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret|password|api[_-]?key)/i.test(key) ? '[REDACTED]' : redact(item, secrets)])); return value; }
async function readResponse(response) {
    if (Number(response.headers.get('content-length')) > 2_000_000)
        throw new ConnectorError('response_too_large', response.status);
    if (response.status === 204)
        return null;
    if (!response.body)
        throw new ConnectorError('invalid_provider_response', response.status);
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > 2_000_000) {
                await reader.cancel();
                throw new ConnectorError('response_too_large', response.status);
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw new ConnectorError('invalid_provider_response', response.status);
    }
}
function nextArgs(tool, data, response, args, requested) {
    const pagination = tool.pagination;
    if (!pagination)
        return null;
    if (pagination.hasMorePath && get(data, pagination.hasMorePath) === false)
        return null;
    if (pagination.type === 'cursor' || pagination.type === 'header') {
        const value = pagination.type === 'header' ? response.headers.get(pagination.headerName ?? 'x-next-page') : get(data, pagination.nextCursorPath ?? 'next_cursor');
        if (value === undefined || value === null || value === '')
            return null;
        if (!pagination.cursorInput)
            throw new ConnectorError('invalid_pagination_configuration');
        const schema = object(tool.inputSchema.properties) ? tool.inputSchema.properties[pagination.cursorInput] : undefined;
        return { [pagination.cursorInput]: object(schema) && schema.type === 'integer' ? Number(value) : value };
    }
    const raw = response.headers.get(pagination.headerName ?? 'link');
    const next = raw?.match(/<([^>]+)>\s*;\s*rel="?next"?/i)?.[1] ?? get(data, pagination.nextCursorPath ?? '@odata.nextLink');
    if (typeof next !== 'string' || !next)
        return null;
    let url;
    try {
        url = new URL(next, requested);
    }
    catch {
        throw new ConnectorError('invalid_pagination_cursor');
    }
    if (url.origin !== requested.origin || url.pathname !== requested.pathname || url.username || url.password || url.hash)
        throw new ConnectorError('unsafe_pagination_target');
    const updated = {};
    for (const [arg, param] of Object.entries(tool.bindings?.query ?? {}))
        if (url.searchParams.has(param)) {
            const schema = object(tool.inputSchema.properties) ? tool.inputSchema.properties[arg] : undefined;
            const value = url.searchParams.get(param);
            updated[arg] = object(schema) && schema.type === 'integer' ? Number(value) : value;
        }
    return Object.keys(updated).length ? updated : null;
}
async function beginIntent(manifest, tool, args, approval, base, options) {
    const root = options.stateDir ?? options.env?.CONNECTOR_STATE_DIR ?? path.join(os.homedir(), '.pipmcp', 'connector-intents');
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    // Credentials rotate: an uncertain write must keep the SAME durable guard after OAuth refresh.
    // Without an explicit stable account ID we intentionally share the key across this provider/tenant.
    const identity = { provider: manifest.id, tool: tool.name, baseUrl: base.href, accountId: options.accountId ?? options.env?.CONNECTOR_ACCOUNT_ID ?? null };
    const key = digest(JSON.stringify({ ...identity, idempotencyKey: approval.idempotencyKey }));
    const file = path.join(root, key + '.json');
    const fingerprint = digest(JSON.stringify({ manifest: manifest.id, tool: tool.name, baseUrl: base.href, args: { ...args, _approval: undefined } }));
    let handle;
    try {
        handle = await fs.open(file, 'wx', 0o600);
    }
    catch (error) {
        if (error.code === 'EEXIST')
            throw new ConnectorError('duplicate_or_uncertain_request');
        throw new ConnectorError('intent_store_unavailable');
    }
    try {
        await handle.writeFile(JSON.stringify({ fingerprint, state: 'running' }));
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    return async (state) => { await fs.writeFile(file, JSON.stringify({ fingerprint, state }), { mode: 0o600 }); };
}
export async function runTool(manifest, toolName, input, options = {}) {
    safeName(manifest.id);
    const tool = manifest.tools.find(tool => tool.name === toolName);
    if (!tool)
        throw new ConnectorError('tool_not_found');
    if (typeof tool.readOnly !== 'boolean' || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(tool.method.toUpperCase()))
        throw new ConnectorError('invalid_manifest');
    const args = await validatedArgs(tool, input);
    const env = options.env ?? process.env;
    const approval = object(args._approval) ? args._approval : undefined;
    if (!tool.readOnly && (!(options.allowWrites ?? env.CONNECTOR_ALLOW_WRITES === 'true') || approval?.approved !== true || typeof approval.idempotencyKey !== 'string' || !approval.idempotencyKey.trim()))
        throw new ConnectorError('write_approval_required');
    const base = endpoint(manifest, env);
    const auth = await authFor(manifest, env, options);
    const timeout = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120_000)
        throw new ConnectorError('invalid_timeout');
    const pageLimit = tool.readOnly && object(args._pagination) ? Number(args._pagination.maxPages ?? 1) : 1;
    const results = [];
    let current = { ...args }, next = null;
    const seen = new Set();
    let completeIntent;
    for (let page = 0; page < pageLimit; page++) {
        await validatedArgs(tool, current);
        const request = requestFor(manifest, tool, current, base, auth, approval);
        if (!tool.readOnly)
            completeIntent = await beginIntent(manifest, tool, current, approval, base, options);
        const timeoutSignal = AbortSignal.timeout(timeout), signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
        let response, data;
        try {
            response = await (options.fetch ?? globalThis.fetch)(request.url.href, { ...request.init, signal });
            if (response.redirected || response.status >= 300 && response.status < 400)
                throw new ConnectorError('provider_redirect_refused', response.status);
            if (!response.ok)
                throw new ConnectorError('provider_http_error', response.status, requestId(response, auth.secrets), retryAfter(response));
            data = await readResponse(response);
            if (object(data) && (data.ok === false || data.success === false || Array.isArray(data.errors) && data.errors.length > 0))
                throw new ConnectorError('provider_operation_failed', response.status, requestId(response, auth.secrets), retryAfter(response));
            if (completeIntent)
                await completeIntent('completed');
        }
        catch (error) {
            if (completeIntent)
                await completeIntent(error instanceof ConnectorError && error.code === 'provider_http_error' && error.status < 500 ? 'refused' : 'uncertain');
            if (error instanceof ConnectorError)
                throw error;
            throw new ConnectorError(tool.readOnly ? (signal.aborted ? 'request_timeout' : 'provider_transport_error') : 'execution_uncertain');
        }
        results.push(redact(data, auth.secrets));
        next = nextArgs(tool, data, response, current, request.url);
        if (!next)
            break;
        const key = JSON.stringify(next);
        if (seen.has(key))
            throw new ConnectorError('repeated_pagination_cursor');
        seen.add(key);
        current = { ...current, ...next };
    }
    return { ok: true, provider: manifest.id, tool: tool.name, data: results.length === 1 ? results[0] : results, pagination: { pagesFetched: results.length, nextArguments: next, complete: next === null, truncated: next !== null }, execution: 'provider-response-received' };
}
export function createServer(manifest, options = {}) {
    safeName(manifest.id);
    const server = new McpServer({ name: manifest.name, version: manifest.version });
    for (const tool of manifest.tools) {
        safeName(tool.name);
        server.registerTool(tool.name, { description: tool.description, inputSchema: fromJsonSchema(inputSchemaFor(tool)), annotations: { readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly, idempotentHint: tool.readOnly, openWorldHint: true } }, async (args) => {
            try {
                const result = await runTool(manifest, tool.name, args, options);
                return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
            }
            catch (error) {
                const failure = error instanceof ConnectorError ? error : new ConnectorError('connector_failure');
                const result = { ok: false, error: { code: failure.code, status: failure.status, requestId: failure.requestId, retryAfter: failure.retryAfter } };
                return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
            }
        });
    }
    return server;
}
export function startServer(manifest, options = {}) { return serveStdio(() => createServer(manifest, options)); }
