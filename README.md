# Zoho CRM MCP server

Review lead records and explicitly create an authorized new lead in a US-region CRM.

A direct-provider MCP server with useful local execution. No PipMCP account is required for local use. Provider API access and any provider charges are your responsibility.

## Quick start

Requires Node.js22+. Clone this repository, then run:

```sh
npm ci --ignore-scripts
npm test
npm start
```

The default command inspects the tools offline. Configure your own credentials in your environment:

- `ZOHO_CRM_ACCESS_TOKEN`



Credential help: https://raw.githubusercontent.com/zoho/crm-oas/main/v8.0/record/record.yaml

## Provider setup

Supply a short-lived access token from your own Zoho OAuth app, ZohoCRM.modules.leads.READ/CREATE scopes. This manifest explicitly uses the US data center www.zohoapis.com. Tokens from other regions require a separately reviewed matching regional manifest; do not send them to this host. Creation can trigger configured Zoho workflows and notifications; review them before approving.

## Execute a real read

Replace example record IDs with records you are authorized to access.

```sh
npm start -- --call zoho_list_leads '{"page":1,"per_page":10,"fields":"Last_Name,Company,Email"}'
```

## Use with an MCP client

Launch `node /absolute/path/zoho-crm-mcp/server.mjs` using stdio transport; pass credentials through the client environment. Stdout is reserved for JSON-RPC.

## Tools

| Tool | Effect | Purpose |
| --- | --- | --- |
| zoho_list_leads | Read | Read a page of leads with an explicit field selection. |
| zoho_create_lead | Explicit approval required | Create one lead; CRM-specific mandatory fields and validation still apply. |

## Concrete workflow

Review lead records and explicitly create an authorized new lead in a US-region CRM.

1. zoho_list_leads
2. zoho_create_lead

## Optional writes

Writes are disabled by default. Set CONNECTOR_ALLOW_WRITES=true and supply `_approval: {approved:true,idempotencyKey:"unique-request-id"}` on the specific call. Do not reuse a key for a different request. Uncertain outcomes are never automatically replayed; inspect the provider before another attempt.

## Capability evidence

Local: **Tested — HTTP fixtures and real stdio tools/call**. Managed: **Documented**. Provider authentication and live operations have not been established by these fixture tests. Evidence applies per operation and execution mode; setup discovery does not imply provider execution.

## Managed production

[Import with PipMCP](https://pipmcp.com/github/start?integration=openapi-to-mcp&utm_source=github&utm_campaign=github-zoho-crm-mcp&utm_content=readme) when you want the hosted service. This provider is not currently listed as a managed template. Import selected-openapi.json (REST) or the official GraphQL schema linked in provenance, configure authentication, and review the tools before execution. Local credentials are not uploaded by this code. Review provider permissions in the managed onboarding. [Directory and related projects](https://jannikco.github.io/pipmcp-connectors/integrations/zoho-crm/).

## Provenance and maintenance

- https://raw.githubusercontent.com/zoho/crm-oas/main/v8.0/record/record.yaml

Maintainer:jannikco. MIT license for this code. See connector.json for selected operations and integration.json for evidence. Runtime dependencies retain their own licenses. Report sensitive issues through https://pipmcp.com/contact; do not post credentials or customer data in public issues.
