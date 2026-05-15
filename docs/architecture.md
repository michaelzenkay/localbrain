# Architecture

`localbrain` has four pieces:

1. An MCP client starts `scripts/localbrain-stdio.mjs`.
2. The stdio bridge forwards JSON-RPC requests to the local Supabase Edge Function.
3. The function checks `MCP_ACCESS_KEY`, applies any namespace scope for that key, calls local Ollama for embeddings and metadata, and stores records in Postgres.
4. Postgres with pgvector performs semantic search through the `match_thoughts` RPC.

The default namespace is `localbrain`. Optional namespaces such as `work`,
`research`, and `journal` are plain metadata filters, so one local vector table
can serve several contexts without introducing multi-node coordination.

## Data Model

`thoughts.content` stores the original text. `thoughts.embedding` stores a
1024-dimensional vector from `mxbai-embed-large`. `thoughts.metadata` stores
JSON fields such as `brain_id`, `topics`, `people`, `action_items`, `type`,
`source_client`, and update attribution.

`thoughts.content_fingerprint` is a normalized SHA-256 hash of the content.
`capture_thought` uses `upsert_thought`, so duplicate captures in the same
namespace merge metadata instead of creating duplicate rows. The same content
can still exist separately in different namespaces. `thoughts.updated_at` is
maintained by a database trigger whenever a row changes.

## Namespace Access

The database enables row level security and grants the service role explicit
access to the local tables and functions. Because the MCP function uses the
service role internally, namespace protection is also enforced in the MCP
server after it authenticates the request key.

`MCP_ACCESS_KEY_SCOPES=*` gives the default key access to every namespace.
`MCP_ACCESS_KEYS` can define additional scoped keys:

```text
admin:<admin-key>:*
journal-client:<journal-key>:localbrain|journal
workstation:<work-key>:work|research
```

Restricted keys cannot query, list, update, or delete thoughts outside their
allowed namespaces. If a restricted key omits `brain_id` while searching or
listing, the server defaults to the first namespace in that key's scope.

## Locality

`OLLAMA_LOCAL_ONLY=true` only allows `localhost`, `127.0.0.1`, `::1`, or
`host.docker.internal` for model calls. Disable it only if you intentionally
point to a remote model endpoint.
