import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") || "";
const MCP_ACCESS_KEYS_RAW = Deno.env.get("MCP_ACCESS_KEYS") || "";
const MCP_ACCESS_KEY_SCOPES = Deno.env.get("MCP_ACCESS_KEY_SCOPES") || "*";
const OLLAMA_BASE = Deno.env.get("OLLAMA_BASE") || "http://host.docker.internal:11434/v1";
const EMBED_MODEL = Deno.env.get("OLLAMA_EMBED_MODEL") || "mxbai-embed-large";
const CHAT_MODEL = Deno.env.get("OLLAMA_CHAT_MODEL") || "qwen2.5:4b-instruct";
const OLLAMA_LOCAL_ONLY = (Deno.env.get("OLLAMA_LOCAL_ONLY") || "true").toLowerCase() !== "false";
const DEFAULT_BRAIN_ID = Deno.env.get("DEFAULT_BRAIN_ID") || "localbrain";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type AccessKey = { label: string; key: string; brainIds: string[] | null };
type Thought = { id: string; content: string; metadata: Record<string, unknown>; created_at?: string };

function parseBrainScopes(raw: string | undefined): string[] | null {
  const value = (raw || "*").trim();
  if (!value || value === "*") return null;
  return value.split("|").map((part) => part.trim()).filter(Boolean);
}

function configuredAccessKeys(): AccessKey[] {
  const keys: AccessKey[] = [];
  if (MCP_ACCESS_KEY.trim()) {
    keys.push({ label: "default", key: MCP_ACCESS_KEY.trim(), brainIds: parseBrainScopes(MCP_ACCESS_KEY_SCOPES) });
  }

  for (const rawPart of MCP_ACCESS_KEYS_RAW.split(/[,\n]/)) {
    const part = rawPart.trim();
    if (!part) continue;

    const pieces = part.split(":");
    if (pieces.length === 1) {
      keys.push({ label: "unnamed", key: part, brainIds: null });
      continue;
    }

    const label = pieces.shift()?.trim() || "unnamed";
    const key = pieces.shift()?.trim() || "";
    const scopes = pieces.join(":").trim();
    if (key) keys.push({ label, key, brainIds: parseBrainScopes(scopes || "*") });
  }

  return keys;
}

const ACCESS_KEYS = configuredAccessKeys();
if (!ACCESS_KEYS.length) {
  throw new Error("Set MCP_ACCESS_KEY or MCP_ACCESS_KEYS before serving local-memory-mcp.");
}

function authenticateAccessKey(provided: string | null | undefined): AccessKey | null {
  if (!provided) return null;
  return ACCESS_KEYS.find((candidate) => candidate.key === provided) || null;
}

function canAccessBrain(auth: AccessKey, brainId: string): boolean {
  return auth.brainIds === null || auth.brainIds.includes(brainId);
}

function readableBrainId(auth: AccessKey, requested: string | undefined): string | null {
  if (requested) return canAccessBrain(auth, requested) ? requested : null;
  if (auth.brainIds === null) return null;
  return auth.brainIds[0] || DEFAULT_BRAIN_ID;
}

function writableBrainId(auth: AccessKey, requested: string | undefined): string | null {
  const brainId = requested || DEFAULT_BRAIN_ID;
  return canAccessBrain(auth, brainId) ? brainId : null;
}

function accessDenied(brainId: string): { content: { type: "text"; text: string }[]; isError: true } {
  return {
    content: [{ type: "text" as const, text: `Access denied for namespace "${brainId}".` }],
    isError: true,
  };
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== ""));
}

function assertLocalOllamaBase(base: string) {
  if (!OLLAMA_LOCAL_ONLY) return;
  const host = new URL(base).hostname.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);
  if (!localHosts.has(host)) {
    throw new Error(`OLLAMA_LOCAL_ONLY is enabled, but OLLAMA_BASE points to non-local host: ${host}`);
  }
}

assertLocalOllamaBase(OLLAMA_BASE);

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA_BASE}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`Ollama embeddings failed: ${r.status} ${await r.text().catch(() => "")}`);
  const d = await r.json();
  return d.data[0].embedding;
}

function extractJson(raw: string): Record<string, unknown> {
  const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  return JSON.parse(stripped);
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what is explicitly present. Return valid JSON only.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return extractJson(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

async function resolveThought(idOrQuery: string, auth: AccessKey): Promise<Thought | { error: string }> {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(idOrQuery.trim())) {
    const { data, error } = await supabase.from("thoughts").select("id, content, metadata").eq("id", idOrQuery.trim()).single();
    if (error || !data) return { error: `No thought found with ID ${idOrQuery}` };
    const thought = data as Thought;
    const brainId = typeof thought.metadata?.brain_id === "string" ? thought.metadata.brain_id : DEFAULT_BRAIN_ID;
    if (!canAccessBrain(auth, brainId)) return { error: `Access denied for namespace "${brainId}".` };
    return thought;
  }

  const qEmb = await getEmbedding(idOrQuery);
  const scopedBrainId = readableBrainId(auth, undefined);
  const { data, error } = await supabase.rpc("match_thoughts", {
    query_embedding: qEmb,
    query_text: idOrQuery,
    match_threshold: 0,
    match_count: 1,
    brain_id: scopedBrainId,
  });
  if (error) return { error: `Search failed: ${error.message}` };
  if (!data || !data.length) return { error: `No thought found matching "${idOrQuery}"` };
  return { id: data[0].id, content: data[0].content, metadata: data[0].metadata || {} };
}

function createMcpServer(auth: AccessKey): McpServer {
  const server = new McpServer({ name: "localbrain", version: "0.1.0" });

server.registerTool("search_thoughts", {
  title: "Search Thoughts",
  description: "Search captured thoughts by meaning.",
  inputSchema: {
    query: z.string().describe("What to search for"),
    limit: z.number().optional().default(10),
    threshold: z.number().optional().default(0.5),
    brain_id: z.string().optional().describe("Optional namespace, such as work or research"),
  },
}, async ({ query, limit, threshold, brain_id }) => {
  try {
    const scopedBrainId = readableBrainId(auth, brain_id);
    if (brain_id && scopedBrainId === null) return accessDenied(brain_id);
    const qEmb = await getEmbedding(query);
    const { data, error } = await supabase.rpc("match_thoughts", {
      query_embedding: qEmb,
      query_text: query,
      match_threshold: threshold,
      match_count: limit,
      brain_id: scopedBrainId,
    });
    if (error) return { content: [{ type: "text" as const, text: `Search error: ${error.message}` }], isError: true };
    if (!data || !data.length) return { content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }] };
    const results = data.map((t: Thought & { similarity: number }, i: number) => {
      const m = t.metadata || {};
      const parts = [
        `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
        `ID: ${t.id}`,
        `Captured: ${t.created_at ? new Date(t.created_at).toLocaleDateString() : "unknown"}`,
        `Type: ${m.type || "unknown"}`,
      ];
      if (Array.isArray(m.topics) && m.topics.length) parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
      if (Array.isArray(m.people) && m.people.length) parts.push(`People: ${(m.people as string[]).join(", ")}`);
      if (Array.isArray(m.action_items) && m.action_items.length) parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
      parts.push(`\n${t.content}`);
      return parts.join("\n");
    });
    return { content: [{ type: "text" as const, text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}` }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("list_thoughts", {
  title: "List Recent Thoughts",
  description: "List recently captured thoughts with optional filters.",
  inputSchema: {
    limit: z.number().optional().default(10),
    brain_id: z.string().optional().describe("Optional namespace"),
    type: z.string().optional().describe("Filter by metadata type"),
    topic: z.string().optional().describe("Filter by topic tag"),
    person: z.string().optional().describe("Filter by person mentioned"),
    days: z.number().optional().describe("Only thoughts from the last N days"),
  },
}, async ({ limit, brain_id, type, topic, person, days }) => {
  try {
    const scopedBrainId = readableBrainId(auth, brain_id);
    if (brain_id && scopedBrainId === null) return accessDenied(brain_id);
    let q = supabase.from("thoughts").select("id, content, metadata, created_at").order("created_at", { ascending: false }).limit(limit);
    if (scopedBrainId) q = q.contains("metadata", { brain_id: scopedBrainId });
    if (type) q = q.contains("metadata", { type });
    if (topic) q = q.contains("metadata", { topics: [topic] });
    if (person) q = q.contains("metadata", { people: [person] });
    if (days) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      q = q.gte("created_at", since.toISOString());
    }
    const { data, error } = await q;
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    if (!data || !data.length) return { content: [{ type: "text" as const, text: "No thoughts found." }] };
    const results = data.map((t: Thought, i: number) => {
      const m = t.metadata || {};
      const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
      return `${i + 1}. [${t.created_at ? new Date(t.created_at).toLocaleDateString() : "unknown"}] (${m.type || "unknown"}${tags ? " - " + tags : ""})\n   ID: ${t.id}\n   ${t.content}`;
    });
    return { content: [{ type: "text" as const, text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}` }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("thought_stats", {
  title: "Thought Statistics",
  description: "Summarize captured thoughts by totals, namespaces, types, topics, and people.",
  inputSchema: {},
}, async () => {
  try {
    const { data } = await supabase.from("thoughts").select("metadata, created_at").order("created_at", { ascending: false });
    const types: Record<string, number> = {}, topics: Record<string, number> = {}, people: Record<string, number> = {}, brains: Record<string, number> = {};
    const scopedData = (data || []).filter((r) => {
      if (auth.brainIds === null) return true;
      const m = (r.metadata || {}) as Record<string, unknown>;
      const brain = (m.brain_id as string) || DEFAULT_BRAIN_ID;
      return auth.brainIds.includes(brain);
    });
    for (const r of scopedData) {
      const m = (r.metadata || {}) as Record<string, unknown>;
      const brain = (m.brain_id as string) || "unassigned";
      brains[brain] = (brains[brain] || 0) + 1;
      if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
      if (Array.isArray(m.topics)) for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
      if (Array.isArray(m.people)) for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
    }
    const sort = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const lines = [
      `Total thoughts: ${scopedData.length}`,
      `Date range: ${scopedData.length ? new Date(scopedData[scopedData.length - 1].created_at).toLocaleDateString() + " to " + new Date(scopedData[0].created_at).toLocaleDateString() : "N/A"}`,
      "",
      "Namespaces:",
      ...sort(brains).map(([k, v]) => `  ${k}: ${v}`),
      "",
      "Types:",
      ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
    ];
    if (Object.keys(topics).length) lines.push("", "Top topics:", ...sort(topics).map(([k, v]) => `  ${k}: ${v}`));
    if (Object.keys(people).length) lines.push("", "People mentioned:", ...sort(people).map(([k, v]) => `  ${k}: ${v}`));
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("list_brains", {
  title: "List Namespaces",
  description: "List available memory namespaces and their purposes.",
  inputSchema: {},
}, async () => {
  try {
    let q = supabase.from("brains").select("id, display_name, purpose, profile_path").order("id");
    if (auth.brainIds !== null) q = q.in("id", auth.brainIds);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    if (!data || !data.length) return { content: [{ type: "text" as const, text: "No namespaces registered yet." }] };
    const lines = data.map((b: { id: string; display_name: string; purpose: string; profile_path: string | null }) =>
      `${b.id} (${b.display_name})\n  ${b.purpose}${b.profile_path ? `\n  Profile: ${b.profile_path}` : ""}`,
    );
    return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("capture_thought", {
  title: "Capture Thought",
  description: "Save a new thought, generate an embedding, and extract metadata.",
  inputSchema: {
    content: z.string().describe("The thought to capture"),
    brain_id: z.string().optional().describe(`Memory namespace. Defaults to ${DEFAULT_BRAIN_ID}`),
    node_id: z.string().optional().describe("Optional local node identifier"),
    agent_id: z.string().optional().describe("Optional agent or client identifier"),
    source_client: z.string().optional().describe("Optional source client name"),
  },
}, async ({ content, brain_id, node_id, agent_id, source_client }) => {
  try {
    const [embedding, metadata] = await Promise.all([getEmbedding(content), extractMetadata(content)]);
    const targetBrain = writableBrainId(auth, brain_id);
    if (!targetBrain) return accessDenied(brain_id || DEFAULT_BRAIN_ID);
    const enrichedMetadata = compactMetadata({
      ...metadata,
      brain_id: targetBrain,
      source: "mcp",
      node_id,
      agent_id,
      source_client,
    });
    const { data: upsertResult, error: upsertError } = await supabase.rpc("upsert_thought", {
      p_content: content,
      p_metadata: enrichedMetadata,
    });
    if (upsertError) return { content: [{ type: "text" as const, text: `Failed to capture: ${upsertError.message}` }], isError: true };
    const thoughtId = upsertResult?.id;
    const { error: embError } = await supabase.from("thoughts").update({ embedding }).eq("id", thoughtId);
    if (embError) return { content: [{ type: "text" as const, text: `Failed to save embedding: ${embError.message}` }], isError: true };
    const meta = metadata as Record<string, unknown>;
    let confirmation = `Captured in ${targetBrain} as ${meta.type || "thought"}`;
    if (Array.isArray(meta.topics) && meta.topics.length) confirmation += ` - ${(meta.topics as string[]).join(", ")}`;
    if (Array.isArray(meta.people) && meta.people.length) confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
    if (Array.isArray(meta.action_items) && meta.action_items.length) confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;
    return { content: [{ type: "text" as const, text: confirmation }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("delete_thought", {
  title: "Delete Thought",
  description: "Delete a thought by UUID or natural language description.",
  inputSchema: { target: z.string().describe("UUID or natural language description") },
}, async ({ target }) => {
  try {
    const resolved = await resolveThought(target, auth);
    if ("error" in resolved) return { content: [{ type: "text" as const, text: resolved.error }], isError: true };
    const { error } = await supabase.from("thoughts").delete().eq("id", resolved.id);
    if (error) return { content: [{ type: "text" as const, text: `Delete failed: ${error.message}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Deleted: "${resolved.content}"\n(ID: ${resolved.id})` }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

server.registerTool("update_thought", {
  title: "Update Thought",
  description: "Replace an existing thought, regenerating its embedding and metadata.",
  inputSchema: {
    target: z.string().describe("UUID or natural language description"),
    content: z.string().describe("New content"),
    node_id: z.string().optional().describe("Optional local node identifier"),
    agent_id: z.string().optional().describe("Optional agent or client identifier"),
    source_client: z.string().optional().describe("Optional source client name"),
  },
}, async ({ target, content, node_id, agent_id, source_client }) => {
  try {
    const resolved = await resolveThought(target, auth);
    if ("error" in resolved) return { content: [{ type: "text" as const, text: resolved.error }], isError: true };
    const [embedding, metadata] = await Promise.all([getEmbedding(content), extractMetadata(content)]);
    const existingMetadata = resolved.metadata || {};
    const existingBrain = existingMetadata.brain_id;
    const preservedBrain = typeof existingBrain === "string" ? existingBrain : DEFAULT_BRAIN_ID;
    const { data: fingerprint, error: fingerprintError } = await supabase.rpc("localbrain_content_fingerprint", { content });
    if (fingerprintError) return { content: [{ type: "text" as const, text: `Fingerprint failed: ${fingerprintError.message}` }], isError: true };
    const { error } = await supabase.from("thoughts").update({
      content,
      embedding,
      content_fingerprint: fingerprint,
      metadata: compactMetadata({
        ...metadata,
        brain_id: preservedBrain,
        source: "mcp",
        updated: true,
        node_id: existingMetadata.node_id,
        agent_id: existingMetadata.agent_id,
        source_client: existingMetadata.source_client,
        updated_at: new Date().toISOString(),
        updated_by_node_id: node_id,
        updated_by_agent_id: agent_id,
        updated_by_client: source_client,
      }),
    }).eq("id", resolved.id);
    if (error) return { content: [{ type: "text" as const, text: `Update failed: ${error.message}` }], isError: true };
    const meta = metadata as Record<string, unknown>;
    const topics = Array.isArray(meta.topics) ? (meta.topics as string[]).join(", ") : "uncategorized";
    return { content: [{ type: "text" as const, text: `Updated (ID: ${resolved.id})\nWas: "${resolved.content}"\nNow: ${meta.type || "thought"} - ${topics}` }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

  return server;
}

const app = new Hono();

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key");
  const auth = authenticateAccessKey(provided);
  if (!auth) return c.json({ error: "Invalid or missing access key" }, 401);

  const server = createMcpServer(auth);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
