# Release Manifest

This clean public draft includes:

- `README.md`: public quick start and project overview
- `LICENSE`: MIT license placeholder
- `.env.example`: local-only configuration template
- `supabase/config.toml`: local Supabase configuration
- `supabase/migrations/20260101000000_localbrain_schema.sql`: clean schema and default namespaces
- `supabase/migrations/20260713000000_harden_localbrain_rls.sql`: least-privilege RLS and capture RPC
- `supabase/functions/local-memory-mcp/`: MCP Edge Function
- `scripts/localbrain-stdio.mjs`: stdio-to-HTTP MCP bridge
- `scripts/localbrain-cli.mjs`: explicit user-initiated capture and search client
- `scripts/install-localbrain-firewall.ps1`, `harden-local-security.ps1`: local security controls
- `scripts/start.ps1`, `stop.ps1`, `status.ps1`, `smoke-test.ps1`: local operations
- `examples/`: MCP client templates
- `docs/`: architecture, client setup, privacy, and troubleshooting

Excluded from the public draft:

- cloud sync
- multi-node coordination
- remote key rotation
- break-glass vault flows
- private profiles, incident logs, local repair notes, and historical migrations
