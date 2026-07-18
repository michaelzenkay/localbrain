# File Classification

Public release files:

| Path | Classification | Notes |
| --- | --- | --- |
| `README.md` | public-core | Quick start and overview |
| `LICENSE` | public-core | MIT license |
| `.env.example` | public-example | Placeholder-only local configuration |
| `.gitignore` | public-core | Excludes secrets, local state, and logs |
| `AGENTS.md` | public-core | Public contributor guidance |
| `docker-compose.yml` | public-example | Optional local Ollama container |
| `supabase/config.toml` | public-core | Local Supabase configuration |
| `supabase/migrations/20260101000000_localbrain_schema.sql` | public-core | Clean schema and seed namespaces |
| `supabase/migrations/20260713000000_harden_localbrain_rls.sql` | public-core | Least-privilege RLS and capture RPC |
| `supabase/functions/local-memory-mcp/` | public-core | MCP endpoint |
| `scripts/localbrain-stdio.mjs` | public-core | Read-only stdio MCP bridge |
| `scripts/localbrain-cli.mjs` | public-core | Explicit capture and search CLI |
| `scripts/install-localbrain-firewall.ps1` | public-core | Windows inbound block rule installer |
| `scripts/harden-local-security.ps1` | public-core | Windows repository ACL hardening |
| `scripts/start.ps1` | public-core | Local startup helper |
| `scripts/stop.ps1` | public-core | Local stop helper |
| `scripts/status.ps1` | public-core | Local status helper |
| `scripts/smoke-test.ps1` | public-core | Capture/search/list/stats test |
| `examples/` | public-example | Generic MCP client templates |
| `docs/` | public-core | Public documentation and review checklists |

Excluded source categories:

| Classification | Release decision |
| --- | --- |
| private-config | Excluded; replaced with templates |
| private-history | Excluded; distilled into generic docs only |
| private-secret | Excluded |
| archive-only | Excluded |
| cloud sync and multi-node workflows | Excluded from first public release |
