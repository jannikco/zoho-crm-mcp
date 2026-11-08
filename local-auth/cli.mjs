#!/usr/bin/env node
/** Login/logout/status for the operator's own provider app. No token values are printed. */
import { readFile } from 'node:fs/promises';
import { login } from './oauth.mjs';
import { createCredentialStore } from './credential-store.mjs';
const [command, file] = process.argv.slice(2);
if (!['login', 'logout', 'status'].includes(command) || !file) {
  console.error('Usage: node local-auth/cli.mjs login|logout|status ./connector.json');
  process.exitCode = 2;
} else {
  try {
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(manifest.id)) throw new Error('Invalid provider');
    const store = createCredentialStore();
    if (command === 'login') console.log(JSON.stringify(await login(manifest, { store })));
    if (command === 'logout') { await store.delete(manifest.id); console.log(JSON.stringify({ provider: manifest.id, removed: true })); }
    if (command === 'status') {
      const manual = Boolean(manifest.auth?.env && process.env[manifest.auth.env]);
      let record; if (!manual) { try { record = await store.load(manifest.id); } catch { /* no credential or unavailable OS vault */ } }
      console.log(JSON.stringify({ provider: manifest.id, configured: manual || Boolean(record?.accessToken), source: manual ? 'environment' : record?.accessToken ? 'os-credential-store' : 'none', ...(record?.expiresAt ? { expiresAt: record.expiresAt } : {}) }));
    }
  } catch {
    console.error('Local authentication failed. Check your provider OAuth app, approved scopes, loopback redirect URI, and native credential-store availability. API-token environment variables are an alternative.');
    process.exitCode = 1;
  }
}
