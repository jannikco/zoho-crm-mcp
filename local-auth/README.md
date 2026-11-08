# Local provider authentication

Use your own provider API key/token through the connector's documented environment variables, or your own OAuth application where the manifest explicitly supports it. No PipMCP account is required.

```sh
node local-auth/cli.mjs login ./connector.json
node local-auth/cli.mjs status ./connector.json
node local-auth/cli.mjs logout ./connector.json
```

Xero uses a customer-created PKCE application. Register `http://127.0.0.1:42813/callback`, set `XERO_CLIENT_ID` and provider-approved `XERO_OAUTH_SCOPES`, then run login. Configure `XERO_TENANT_ID` separately using the organization you authorized. PayPal uses your own Sandbox application's client ID/secret with the client-credentials grant, not a browser redirect. Its default API and token endpoint both target Sandbox. Google Drive, Google Calendar, Outlook, Teams and Dropbox also have documented PKCE configurations in registry/oauth-providers.json; the generated connector merges the matching configuration and starts with read-only scopes. Other connectors use documented manual API credentials; the helper does not invent OAuth support.

Credentials are saved to macOS Keychain (`security`), Linux Secret Service (`secret-tool`, requiring an unlocked desktop Secret Service), or Windows Credential Manager (native WinCred through PowerShell). Unsupported or locked stores fail closed; there is no plaintext token file fallback. Native commands receive secrets through stdin, never process arguments. Native output is captured internally, never forwarded to the user's stdout. `login` returns only provider/stored status. `status` reports configuration presence and expiry, never token values.

The OAuth callback binds only to `127.0.0.1`, checks a random single-use state and uses S256 PKCE only where verified. Redirects during token exchange are refused, responses and exchange duration are bounded, and refresh-token rotation is persisted. The same redirect URI must be registered on your provider application. No central OAuth app, hosted redirect, or PipMCP-owned client secret is used.

```js
import { resolveCredential } from './local-auth/index.mjs';
startServer(connector, { credentialResolver: manifest => resolveCredential(manifest) });
```

`logout` removes the local cached credential; it does not revoke provider-side app consent.

`resolveCredential` honors a process-environment token first, then reads the native credential store and refreshes expired OAuth credentials where supported. Tests use fixture HTTP responses and mocked native commands; real provider login and Linux/Windows vault availability remain operator-dependent. No live provider operation or OS-vault write is performed during automated tests.

Native macOS verification: a real Keychain save/readback/load/delete roundtrip passed with a unique synthetic-only item, which was deleted; no provider token was used. Run the explicit integration check with `RUN_NATIVE_CREDENTIAL_STORE_TESTS=1 node --test tests/local-auth-native.test.mjs`. Default automated tests skip this OS-vault mutation. Linux/Windows adapters remain fixture-tested, not verified on those operating systems in this run.
