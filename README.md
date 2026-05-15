# localbrain

`localbrain` is a small offline memory server for MCP clients. It stores
thoughts in local Postgres with pgvector, creates embeddings with a local
Ollama model, and exposes capture/search/list/update/delete tools through a
stdio MCP bridge.

## What You Get

- Local Supabase/Postgres database with pgvector
- Local embedding and metadata extraction through Ollama
- Supabase Edge Function MCP endpoint
- Stdio bridge for desktop MCP clients
- Starter configs for Claude Desktop, Codex, and OpenClaw-style clients
- Smoke test for capture, search, list, update, delete, and stats

## Requirements

- Node.js 20 or newer
- Supabase CLI
- Docker Desktop or a compatible local Docker runtime
- Ollama with `mxbai-embed-large` and a small instruct chat model, preferably
  `qwen2.5:4b-instruct`

Pull the default local models:

```powershell
ollama pull mxbai-embed-large
ollama pull qwen2.5:4b-instruct
```

`localbrain` uses the chat model only to extract small JSON metadata. Prefer a
small instruct model over a reasoning-oriented model; it should follow the
schema and stop quickly. See `docs/model-selection.md`.

## Quick Start

```powershell
Copy-Item .env.example .env
supabase start
supabase functions serve local-memory-mcp --env-file .env
node scripts/localbrain-stdio.mjs
```

Set `MCP_ACCESS_KEY` in `.env` to a local secret before connecting an MCP
client. If Supabase prints a different local API URL or service role key, copy
those values into `.env`.

For multi-client setups, keep one admin key with `MCP_ACCESS_KEY_SCOPES=*`
and add scoped keys with `MCP_ACCESS_KEYS`, for example:

```text
admin:<admin-key>:*
journal-client:<journal-key>:localbrain|journal
```

## Connect A Client

Use one of the files in `examples/` as a starting point. Replace `<repo>` with
the path where you cloned this repository and set the same `MCP_ACCESS_KEY` in
`.env`.

## Tools

- `capture_thought`: save a thought with metadata and embedding
- duplicate captures in the same namespace are merged by `upsert_thought` using a content fingerprint
- `search_thoughts`: semantic search across stored thoughts
- `list_thoughts`: list recent thoughts with optional filters
- `update_thought`: replace a thought and regenerate metadata
- `delete_thought`: delete by UUID or nearest natural language match
- `thought_stats`: summarize totals, topics, people, and namespaces
- `list_brains`: show available namespaces

## Privacy Model

The default path is offline-first. The database runs locally, embeddings are
created locally, and `OLLAMA_LOCAL_ONLY=true` rejects non-local embedding
hosts. See `docs/privacy.md` before publishing a fork or sharing a memory
store.

## Test

After the local function is running:

```powershell
pwsh ./scripts/smoke-test.ps1
```

## Public Release Note

Publish this repo from a clean export, not from a private working repository
with old history. Run the privacy checklist in `docs/privacy.md` and a secret
scanner before the first public push.
