/** Customer-owned OAuth apps. Loopback + state + PKCE; no PipMCP account and no token logging. */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createCredentialStore } from './credential-store.mjs';
export function secureOAuthUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('OAuth endpoints must be HTTPS URLs without credentials, query or fragment');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') || url.hostname.endsWith('.') || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) throw new Error('OAuth endpoint must be a public DNS hostname');
  return url;
}
export function openBrowserUrl(url, platform = process.platform) {
  const parsed = secureOAuthUrl(new URL(url).origin + new URL(url).pathname);
  if (!parsed) throw new Error('Invalid authorization URL');
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: 'ignore', windowsHide: true }); child.once('error', () => reject(new Error('Could not open browser; configure a supported browser opener'))); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Browser opener failed'))); });
}
function required(env, key, label) { const v = key && env[key]; if (typeof v !== 'string' || !v || /[\r\n]/.test(v)) throw new Error(`Missing ${label}; configure your own provider OAuth app`); return v; }
export async function beginOAuth(config, { env = process.env, timeoutMs = 180000, port = config.redirectPort ?? 42813 } = {}) {
  if (!config || config.grantType === 'client_credentials') throw new Error('This provider requires client credentials; use exchangeClientCredentials instead');
  const authorization = secureOAuthUrl(config.authorizationUrl);
  secureOAuthUrl(config.tokenUrl);
  const clientId = required(env, config.clientIdEnv, 'OAuth client ID');
  if (!config.pkce) required(env, config.clientSecretEnv, 'OAuth client secret (PKCE not verified for this provider)');
  const scope = config.scopeEnv && env[config.scopeEnv] ? required(env, config.scopeEnv, 'OAuth scopes approved for your app') : config.scopes?.join(' ');
  if (config.scopeEnv && !scope) throw new Error('Missing OAuth scopes approved for your app');
  const extras = config.authorizationParams ?? {};
  const allowedExtras = new Set(['access_type', 'prompt', 'token_access_type', 'response_mode']);
  for (const [key, value] of Object.entries(extras)) if (!allowedExtras.has(key) || typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('Unsupported OAuth authorization parameter');
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  let resolveCode, rejectCode, timer;
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Mark handled immediately while the caller opens the browser.
  codePromise.catch(() => {});
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method !== 'GET' || url.pathname !== '/callback') { response.writeHead(404).end(); return; }
    const received = url.searchParams.get('state') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(received) || received.length !== state.length || !timingSafeEqual(Buffer.from(received), Buffer.from(state))) {
      response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Authorization state did not match. Restart local login.');
      rejectCode(new Error('OAuth state mismatch')); return;
    }
    if (url.searchParams.has('error') || !url.searchParams.get('code')) {
      response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Provider authorization was declined or incomplete.');
      rejectCode(new Error('Provider authorization was declined or incomplete')); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end('Authorization received. You can close this window.');
    resolveCode(url.searchParams.get('code'));
  });
  await new Promise((resolve, reject) => { server.once('error', () => reject(new Error('Loopback callback port unavailable; check your OAuth app redirect URI'))); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address(), redirectUri = `http://127.0.0.1:${address.port}/callback`;
  authorization.searchParams.set('response_type', 'code'); authorization.searchParams.set('client_id', clientId); authorization.searchParams.set('redirect_uri', redirectUri); authorization.searchParams.set('state', state);
  if (scope) authorization.searchParams.set('scope', scope);
  for (const [key, value] of Object.entries(extras)) authorization.searchParams.set(key, value);
  if (config.pkce) { authorization.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url')); authorization.searchParams.set('code_challenge_method', 'S256'); }
  timer = setTimeout(() => rejectCode(new Error('OAuth login timed out')), timeoutMs);
  return { authorizationUrl: authorization.href, redirectUri, verifier: config.pkce ? verifier : undefined, code: codePromise, close() { clearTimeout(timer); server.close(); server.closeAllConnections(); } };
}
async function tokenRequest(config, fields, { env = process.env, fetchImpl = globalThis.fetch, previous = {} } = {}) {
  const endpoint = secureOAuthUrl(config.tokenUrl);
  const clientId = required(env, config.clientIdEnv, 'OAuth client ID');
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const body = new URLSearchParams(fields);
  if (config.clientAuthentication === 'basic') {
    const secret = required(env, config.clientSecretEnv, 'OAuth client secret'); headers.Authorization = `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
  } else { body.set('client_id', clientId); if (config.clientSecretEnv && env[config.clientSecretEnv]) body.set('client_secret', env[config.clientSecretEnv]); }
  let response;
  try { response = await fetchImpl(endpoint.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers, body: body.toString() }); } catch { throw new Error('OAuth token exchange failed; check provider configuration'); }
  if (!response.ok || response.redirected) throw new Error(`OAuth token endpoint refused request (HTTP ${response.status})`);
  if (Number(response.headers.get('content-length')) > 65536) throw new Error('OAuth token response is too large');
  let size = 0; const chunks = []; const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty OAuth token response');
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 65536) { await reader.cancel(); throw new Error('OAuth token response is too large'); } chunks.push(value); }
  let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('OAuth token response is not JSON'); }
  if (typeof data.access_token !== 'string' || !data.access_token || /[\r\n]/.test(data.access_token) || (data.token_type && data.token_type.toLowerCase() !== 'bearer')) throw new Error('OAuth response lacks a supported bearer access token');
  return { accessToken: data.access_token, ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : previous.refreshToken ? { refreshToken: previous.refreshToken } : {}), ...(Number.isFinite(data.expires_in) && data.expires_in > 0 ? { expiresAt: Date.now() + data.expires_in * 1000 - 30000 } : {}), ...(typeof data.scope === 'string' ? { scope: data.scope } : {}) };
}
export async function login(manifest, { env = process.env, store = createCredentialStore(), openBrowser = openBrowserUrl, fetchImpl = globalThis.fetch, port, timeoutMs } = {}) {
  const config = manifest.oauth; if (!config) throw new Error('OAuth login is not verified for this provider; use its documented API key or access-token environment variables');
  if (config.grantType === 'client_credentials') return exchangeClientCredentials(manifest, { env, store, fetchImpl });
  const session = await beginOAuth(config, { env, port, timeoutMs });
  try {
    await openBrowser(session.authorizationUrl);
    const code = await session.code;
    const record = await tokenRequest(config, { grant_type: 'authorization_code', code, redirect_uri: session.redirectUri, ...(session.verifier ? { code_verifier: session.verifier } : {}) }, { env, fetchImpl });
    await store.save(manifest.id, record);
    return { provider: manifest.id, stored: true }; // Deliberately never return tokens from login commands.
  } finally { session.close(); }
}
export async function exchangeClientCredentials(manifest, { env = process.env, store = createCredentialStore(), fetchImpl = globalThis.fetch } = {}) {
  const config = manifest.oauth; if (config?.grantType !== 'client_credentials') throw new Error('Client-credentials grant is not configured');
  const record = await tokenRequest(config, { grant_type: 'client_credentials' }, { env, fetchImpl }); await store.save(manifest.id, record); return { provider: manifest.id, stored: true };
}
export async function resolveCredential(manifest, { env = process.env, store = createCredentialStore(), fetchImpl = globalThis.fetch } = {}) {
  if (manifest.auth?.env && env[manifest.auth.env]) return { accessToken: env[manifest.auth.env] };
  let record; try { record = await store.load(manifest.id); } catch { throw new Error('No local OAuth credential available; run login or configure the provider token environment variable'); }
  if (!record?.accessToken) throw new Error('Local OAuth credential is incomplete');
  if (record.expiresAt && record.expiresAt <= Date.now()) {
    if (manifest.oauth?.grantType === 'client_credentials') {
      record = await tokenRequest(manifest.oauth, { grant_type: 'client_credentials' }, { env, fetchImpl });
    } else {
      if (!record.refreshToken || !manifest.oauth) throw new Error('OAuth token expired; run local login again');
      record = await tokenRequest(manifest.oauth, { grant_type: 'refresh_token', refresh_token: record.refreshToken }, { env, fetchImpl, previous: record });
    }
    await store.save(manifest.id, record);
  }
  return { accessToken: record.accessToken };
}
