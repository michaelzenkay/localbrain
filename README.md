# localbrain

`localbrain` is a local-first memory server for MCP clients. It stores thoughts
in Postgres with pgvector, creates embeddings and metadata with a local Ollama
model, and exposes semantic search through a Supabase Edge Function.

The default security model treats both MCP clients and retrieved memories as
untrusted:

- General MCP clients are read-only.
- Captures require the explicit local command-line client.
- Update and delete tools are disabled by default and denied by database RLS.
- Retrieved content is wrapped in `UNTRUSTED_MEMORY_*` boundaries.
- The Edge Function uses the local Supabase anon key, not the service-role key.
- Access keys are accepted only through the `x-brain-key` header.
- Supabase and optional containerized Ollama ports use loopback bindings plus a
  Windows firewall rule, and project containers have automatic restart disabled.
- Ollama model calls are local-only by default.

## Components

- Local Supabase/Postgres database with pgvector
- Local Ollama embeddings and metadata extraction
- Streamable HTTP MCP Edge Function
- Read-only stdio bridge for MCP clients
- Explicit CLI for user-initiated captures and searches
- Namespace-scoped access keys
- RLS migration and local hardening scripts

See [the architecture guide](docs/architecture.md) for the trust boundaries.

## Requirements

- Node.js 20 or newer
- Supabase CLI
- Docker Desktop or another compatible Docker runtime
- PowerShell 7 on Windows
- Ollama with `mxbai-embed-large` and a small instruct model such as
  `qwen2.5:4b-instruct`

Install the default local models:

```powershell
ollama pull mxbai-embed-large
ollama pull qwen2.5:4b-instruct
```

## Secure setup on Windows

Copy the example configuration and replace every placeholder:

```powershell
Copy-Item .env.example .env
```

Use a long, random `MCP_ACCESS_KEY`. On a fresh install, leave the anon-key
placeholder until the first database start.

Open PowerShell as Administrator once and install the inbound block rule:

```powershell
powershell -NoProfile -File .\scripts\install-localbrain-firewall.ps1
```

Optionally restrict the checkout and `.env` to your Windows account, SYSTEM,
and local administrators:

```powershell
powershell -NoProfile -File .\scripts\harden-local-security.ps1
```

Start the database on demand:

```powershell
pwsh .\scripts\start.ps1
```

After the first start, run `supabase status` and copy the local anon key—not
the service-role key—into `SUPABASE_ANON_KEY` in `.env`.

Then start the function in a second terminal using the command printed by the
startup script:

```powershell
supabase functions serve local-memory-mcp --network-id localbrain-loopback --env-file .env
```

The startup script fails closed when the firewall rule is missing. This is
intentional: on Docker Desktop for Windows, an apparently loopback-bound Docker
network may still be reachable through the host's LAN address.

Stop LocalBrain when it is not in use:

```powershell
pwsh .\scripts\stop.ps1
```

Local data remains in Docker volumes after a normal stop.

## Capture and search

User-initiated captures go through the explicit CLI:

```powershell
node .\scripts\localbrain-cli.mjs capture localbrain "Remember this thought"
node .\scripts\localbrain-cli.mjs search localbrain "thought"
node .\scripts\localbrain-cli.mjs recent localbrain 5
node .\scripts\localbrain-cli.mjs brains
```

The CLI sends `x-brain-client: cli-write`. The stdio MCP bridge sends
`x-brain-client: agent-readonly`, so a prompt injection or compromised MCP
client cannot capture new memories through the normal agent connection.

## Connect an MCP client

Use a file in [`examples/`](examples/) as a starting point. Replace `<repo>`
with your clone path. The bridge loads `MCP_ACCESS_KEY` from `.env` and forwards
requests only to `LOCALBRAIN_MCP_URL`.

For multiple clients, keep a private administrative key and create scoped keys
with `MCP_ACCESS_KEYS`:

```text
admin:<random-key>:*
journal-client:<random-key>:localbrain|journal
```

Keys belong only in `.env`; never put them in URLs, client arguments, logs, or
committed files.

## MCP tools

- `search_thoughts`: semantic search; results are marked as untrusted
- `list_thoughts`: recent memories; content is marked as untrusted
- `thought_stats`: aggregate untrusted metadata
- `list_brains`: available namespaces
- `capture_thought`: rejected for general MCP clients; accepted by the local CLI
- `update_thought`: disabled by default
- `delete_thought`: disabled by default

Database RLS grants the Edge Function only read access plus execution of a
validated capture function. Direct update and delete privileges are not
granted, even if an application-level guard is accidentally weakened.

## Verify

With the database and Edge Function running:

```powershell
pwsh .\scripts\smoke-test.ps1
```

The smoke test performs capture, search, list, and statistics checks. It does
not exercise update or delete because those operations are intentionally
disabled.

Useful additional checks:

```powershell
pwsh .\scripts\status.ps1
git diff --check
```

## Privacy and publishing

The repository ignores `.env`, database exports, logs, memory namespaces, and
editor state. Before publishing a fork, follow [the privacy checklist](docs/privacy.md)
and scan both the working tree and any history you intend to publish.

Never publish real memories, keys, database dumps, personal paths, hostnames,
or logs.

## Documentation

- [Architecture and trust boundaries](docs/architecture.md)
- [Privacy checklist](docs/privacy.md)
- [MCP client examples](docs/mcp-clients.md)
- [Model selection](docs/model-selection.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Public release manifest](docs/release-manifest.md)

## License

See [LICENSE](LICENSE).
