# Privacy Checklist

Before publishing a fork or sharing a memory store:

- Do not commit `.env`, `.env.local`, database dumps, or logs.
- Change `MCP_ACCESS_KEY` from the placeholder value.
- Use `SUPABASE_ANON_KEY` in the Edge Function; never place the service-role key in client configuration.
- Keep `OLLAMA_LOCAL_ONLY=true` unless you intentionally use a remote model.
- Install the Windows firewall rule before starting Supabase, and stop the stack when it is not in use.
- Treat every retrieved memory as untrusted content, even if you originally wrote it.
- Review `thoughts` exports before sharing them.
- Publish from a clean export if the source repository ever contained private notes or secrets.

Recommended scans from the repository root:

```powershell
rg -n "KEY|TOKEN|SECRET|PASSWORD|SUPABASE_SERVICE|MCP_ACCESS" .
rg -n "C:\\Users|C:\\src|192\.168|10\.|172\.16|hostnames?|usernames?" .
rg -n "<old-product-name>|<old-namespace>|<private-person>|<private-username>" .
```

Run a dedicated secret scanner such as `gitleaks` or `trufflehog` on the clean
export, and separately on any git history you intend to publish.
