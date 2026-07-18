# Architecture

`localbrain` has five pieces:

1. An MCP client starts `scripts/localbrain-stdio.mjs` in read-only mode.
2. The stdio bridge forwards JSON-RPC requests to the local Supabase Edge Function.
3. The function checks the header-only `MCP_ACCESS_KEY`, applies any namespace scope for that key, and calls local Ollama for searches.
4. Explicit captures use `scripts/localbrain-cli.mjs`, which marks the request as a user-initiated write and stores it through a validated database function.
5. Postgres with pgvector performs semantic search through the `match_thoughts` RPC.

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

The database enables row level security. The Edge Function uses the local anon
key, which can read memories and execute the narrowly scoped `upsert_thought`
capture function. It has no direct update or delete privileges. The capture
function validates content size, metadata shape, namespace, and embedding
before writing. Namespace scopes are additionally enforced by the MCP server
after it authenticates the request key.

`MCP_ACCESS_KEY_SCOPES=*` gives the default key access to every namespace.
`MCP_ACCESS_KEYS` can define additional scoped keys:

```text
admin:<admin-key>:*
journal-client:<journal-key>:localbrain|journal
workstation:<work-key>:work|research
```

Restricted keys cannot query, list, or capture outside their allowed
namespaces. Update and delete are disabled globally. If a restricted key omits
`brain_id` while searching or listing, the server defaults to the first
namespace in that key's scope.

## Prompt-injection boundary

Memory content and metadata may contain adversarial instructions. Search,
listing, statistics, and namespace output is wrapped in explicit
`UNTRUSTED_MEMORY_*` markers, and tool descriptions tell MCP clients not to
follow instructions from retrieved data. The stdio bridge cannot capture, so a
retrieved instruction cannot directly write another memory.

## Network and lifecycle boundary

On Windows, the startup helper requires an inbound firewall block for local
Supabase and Ollama ports and creates a Docker network whose default published-port
binding is `127.0.0.1`. Both layers are required because Docker Desktop may
still make published ports reachable through the host LAN address. Supabase
containers are set to restart policy `no` and are started only on demand.

## Locality

`OLLAMA_LOCAL_ONLY=true` only allows `localhost`, `127.0.0.1`, `::1`, or
`host.docker.internal` for model calls. Disable it only if you intentionally
point to a remote model endpoint.
