---
name: pipmcp-zoho-crm
description: Connect AI agents to Zoho CRM using one PipMCP API key and actual hosted tool discovery.
---

# Zoho CRM MCP server

Read capabilities.json and README.md. Use authenticated discovery before selecting a tool. The actual server schemas and selected connection define what can run; never infer tool names from the repository title.

Use only PIPMCP_API_KEY for PipMCP. Provider credentials belong in the hosted product. Do not request another AI model API key for these instructions. Never print keys or commit result records.

For a no-network setup plan run npm start. For authenticated discovery run npm run doctor after the user supplies an authorized scoped key. 

Preserve policy/approval receipts and stable idempotency keys. Pending is not completed. Uncertain writes must be reconciled; never retry with a new key to bypass a hold. Existing MCP client approval and hosted policy remain authoritative.
