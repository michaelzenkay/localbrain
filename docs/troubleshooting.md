# Troubleshooting

## The bridge says localbrain is unreachable

Start the function:

```powershell
supabase functions serve local-memory-mcp --env-file .env
```

Check that `LOCALBRAIN_MCP_URL` matches the API port printed by Supabase.

## Missing access key

Copy `.env.example` to `.env` and replace `<localbrain-key>` with a local
secret. The same file is used by the Edge Function and stdio bridge.

## Ollama cannot be reached

Confirm Ollama is running and the embedding model is installed:

```powershell
ollama list
ollama pull mxbai-embed-large
```

When the Edge Function runs in Docker, `OLLAMA_BASE` should usually be
`http://host.docker.internal:11434/v1`.

## Search returns no results

Lower the `threshold` argument temporarily. Confirm the smoke test can capture
and search a unique thought.
