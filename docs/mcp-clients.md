# MCP Clients

Start the Supabase function first:

```powershell
supabase functions serve local-memory-mcp --network-id localbrain-loopback --env-file .env
```

Then configure your MCP client to run:

```text
node <repo>/scripts/localbrain-stdio.mjs
```

Templates live in `examples/`. The bridge reads `.env` from the repo root and
injects `MCP_ACCESS_KEY` into HTTP requests, so the client config does not need
to contain the key. The bridge identifies itself as `agent-readonly`; capture
requests must use `scripts/localbrain-cli.mjs` instead.

Use `LOCALBRAIN_MCP_URL` if your Supabase API port differs from `54321`.
