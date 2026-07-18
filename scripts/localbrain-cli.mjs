#!/usr/bin/env node

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(__dirname, "..", ".env");

function loadEnv(path) {
  const values = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return values;
}

const env = loadEnv(ENV_FILE);
const KEY = process.env.MCP_ACCESS_KEY || env.MCP_ACCESS_KEY || "";
const ENDPOINT = process.env.LOCALBRAIN_MCP_URL || env.LOCALBRAIN_MCP_URL ||
  "http://127.0.0.1:54321/functions/v1/local-memory-mcp";
const NODE_ID = process.env.NODE_ID || env.NODE_ID || "local";
const AGENT_ID = process.env.AGENT_ID || env.AGENT_ID || "shell";

function usage(code = 0) {
  const output = code ? process.stderr : process.stdout;
  output.write(`Usage:
  node scripts/localbrain-cli.mjs capture <namespace> <text>
  node scripts/localbrain-cli.mjs search  <namespace> <query>
  node scripts/localbrain-cli.mjs recent  <namespace> [limit]
  node scripts/localbrain-cli.mjs brains
`);
  process.exit(code);
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function parseResponse(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data && data !== "[DONE]") events.push(JSON.parse(data));
  }
  return events.length ? events.at(-1) : JSON.parse(text);
}

async function callTool(name, args) {
  if (!KEY || KEY.includes("<")) throw new Error(`Set MCP_ACCESS_KEY in ${ENV_FILE}`);
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-brain-key": KEY,
      "x-brain-client": "cli-write",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  const message = parseResponse(text);
  if (message.error) throw new Error(message.error.message || JSON.stringify(message.error));
  return message.result;
}

function printResult(result) {
  for (const part of result?.content || []) {
    if (part.type === "text") process.stdout.write(`${part.text}\n`);
  }
}

async function main() {
  const [command, namespace, ...rest] = process.argv.slice(2);
  if (!command || ["help", "-h", "--help"].includes(command)) usage();
  if (command === "brains") {
    printResult(await callTool("list_brains", {}));
    return;
  }
  if (!namespace) usage(1);

  if (command === "capture") {
    const content = rest.join(" ").trim() || await readStdin();
    if (!content) throw new Error("capture requires text as arguments or stdin");
    printResult(await callTool("capture_thought", {
      brain_id: namespace,
      content,
      node_id: NODE_ID,
      agent_id: AGENT_ID,
      source_client: "localbrain-cli",
    }));
    return;
  }
  if (command === "search") {
    const query = rest.join(" ").trim();
    if (!query) throw new Error("search requires a query");
    printResult(await callTool("search_thoughts", { brain_id: namespace, query, limit: 10, threshold: 0.2 }));
    return;
  }
  if (command === "recent") {
    const parsed = Number.parseInt(rest[0] || "10", 10);
    const limit = Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 10;
    printResult(await callTool("list_thoughts", { brain_id: namespace, limit }));
    return;
  }
  usage(1);
}

main().catch((error) => {
  process.stderr.write(`localbrain: ${error.message}\n`);
  process.exit(1);
});
