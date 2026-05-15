#!/usr/bin/env node

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as readline from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(__dirname, "..", ".env");

function loadEnv(path) {
  const env = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return env;
}

const env = loadEnv(ENV_FILE);
const NODE_ID = process.env.NODE_ID || env.NODE_ID || "local";
const AGENT_ID = process.env.AGENT_ID || env.AGENT_ID || "mcp";
const SOURCE_CLIENT = process.env.SOURCE_CLIENT || env.SOURCE_CLIENT || "localbrain-stdio";

function accessKeyForNode(raw, nodeId) {
  if (!raw || !nodeId) return "";
  for (const rawPart of raw.split(/[,\n]/)) {
    const part = rawPart.trim();
    if (!part) continue;
    const pieces = part.split(":");
    if (pieces.length < 2) continue;
    const label = pieces.shift().trim();
    const key = pieces.shift().trim();
    if (label === nodeId && key) return key;
  }
  return "";
}

const KEY = process.env.MCP_ACCESS_KEY ||
  env.MCP_ACCESS_KEY ||
  accessKeyForNode(process.env.MCP_ACCESS_KEYS || env.MCP_ACCESS_KEYS || "", NODE_ID) ||
  "";
const ENDPOINT = process.env.LOCALBRAIN_MCP_URL ||
  env.LOCALBRAIN_MCP_URL ||
  "http://127.0.0.1:54321/functions/v1/local-memory-mcp";

if (!KEY || KEY.includes("<")) {
  process.stderr.write("localbrain-stdio: set MCP_ACCESS_KEY in .env before starting the bridge\n");
  process.exit(1);
}

let sessionId = null;
let pending = Promise.resolve();

function attributionArgs() {
  return Object.fromEntries(Object.entries({
    node_id: NODE_ID,
    agent_id: AGENT_ID,
    source_client: SOURCE_CLIENT,
  }).filter(([, value]) => value));
}

function addAttribution(body) {
  if (body?.method !== "tools/call") return body;
  const toolName = body.params?.name;
  if (toolName !== "capture_thought" && toolName !== "update_thought") return body;

  body.params.arguments = body.params.arguments || {};
  for (const [key, value] of Object.entries(attributionArgs())) {
    if (!body.params.arguments[key]) body.params.arguments[key] = value;
  }
  return body;
}

async function post(body) {
  const headers = {
    "content-type": "application/json",
    "x-brain-key": KEY,
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  let res;
  try {
    res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e) {
    if (body.id != null) {
      write({ jsonrpc: "2.0", id: body.id, error: { code: -32603, message: `localbrain unreachable: ${e.message}` } });
    }
    return;
  }

  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    const text = await res.text().catch(() => "");
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try { write(JSON.parse(data)); } catch {}
    }
  } else {
    const text = await res.text().catch(() => "");
    if (!text.trim()) return;
    try {
      write(JSON.parse(text));
    } catch {
      process.stderr.write(`localbrain-stdio: non-JSON response: ${text}\n`);
    }
  }
}

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { return; }
  pending = pending.then(() => post(addAttribution(msg)));
});

rl.on("close", () => {
  pending.catch((err) => {
    process.stderr.write(`localbrain-stdio: ${err.message}\n`);
    process.exitCode = 1;
  });
});
