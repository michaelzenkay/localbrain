# Model Selection

`localbrain` uses two local Ollama models for two different jobs.

## Embeddings

Use an embedding model for semantic search:

```powershell
ollama pull mxbai-embed-large
```

Set:

```env
OLLAMA_EMBED_MODEL=mxbai-embed-large
```

## Metadata Extraction

Use a small instruct model for metadata extraction:

```powershell
ollama pull qwen2.5:4b-instruct
```

Set:

```env
OLLAMA_CHAT_MODEL=qwen2.5:4b-instruct
```

The chat model is not doing deep reasoning. It reads a captured thought and
returns compact JSON such as topics, people, action items, dates, and type.

For this job, an instruct model is usually better than a reasoning-oriented
model because it is optimized to follow a direct instruction and stop. A
reasoning model may spend extra time thinking through a task that should be a
small extraction step, which can make capture feel slow or unreliable.

Good default:

- embedding: `mxbai-embed-large`
- metadata: `qwen2.5:4b-instruct`

If `qwen2.5:4b-instruct` is not available on your machine, use the smallest
Qwen 2.5 instruct model you have installed and keep the prompt JSON-only.
