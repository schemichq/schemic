import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

// Host for the SurrealQL language server (a standalone stdio LSP, JSON-RPC with
// Content-Length framing — unlike tsserver's Node IPC). Gives real .surql completion /
// hover / signature-help / diagnostics. The renderer drives it over IPC (src/main/index.ts).

export type LspMessage = { [key: string]: unknown };

/** Locate the server binary: explicit override, then PATH, then the cargo bin dir. */
function resolveBinary(): string | null {
  const env = process.env.SURREALQL_LSP;
  if (env && existsSync(env)) return env;
  const name = "surrealql-language-server";
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  const cargo = join(homedir(), ".cargo", "bin", name);
  if (existsSync(cargo)) return cargo;
  return null;
}

export function surqlLspAvailable(): boolean {
  return resolveBinary() !== null;
}

let server: ChildProcess | null = null;
let id = 0;
const pending = new Map<number, (msg: LspMessage) => void>();
let eventSink: ((msg: LspMessage) => void) | null = null;
let initialized: Promise<void> | null = null;
let buffer = Buffer.alloc(0);

export function setSurqlEventSink(fn: (msg: LspMessage) => void): void {
  eventSink = fn;
}

function send(msg: LspMessage): void {
  const json = JSON.stringify({ jsonrpc: "2.0", ...msg });
  const payload = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
  server?.stdin?.write(payload);
}

function handle(msg: LspMessage): void {
  // Response to one of our requests.
  if (
    msg.id !== undefined &&
    (msg.result !== undefined || msg.error !== undefined)
  ) {
    const cb = pending.get(msg.id as number);
    if (cb) {
      pending.delete(msg.id as number);
      cb(msg);
    }
    return;
  }
  // Server -> client request: reply so the server doesn't block (configuration -> []).
  if (msg.id !== undefined && typeof msg.method === "string") {
    const result = msg.method === "workspace/configuration" ? [] : null;
    send({ id: msg.id, result });
    return;
  }
  // Notification (e.g. textDocument/publishDiagnostics).
  if (typeof msg.method === "string") eventSink?.(msg);
}

function onData(chunk: Buffer): void {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const header = buffer.indexOf("\r\n\r\n");
    if (header === -1) return;
    const match = /Content-Length: (\d+)/i.exec(
      buffer.subarray(0, header).toString("utf8"),
    );
    if (!match) {
      buffer = buffer.subarray(header + 4);
      continue;
    }
    const len = Number(match[1]);
    const start = header + 4;
    if (buffer.length < start + len) return;
    const body = buffer.subarray(start, start + len).toString("utf8");
    buffer = buffer.subarray(start + len);
    try {
      handle(JSON.parse(body));
    } catch {
      // ignore malformed frame
    }
  }
}

function ensureServer(rootUri: string | null): Promise<void> {
  if (initialized) return initialized;
  const bin = resolveBinary();
  if (!bin)
    return Promise.reject(new Error("surrealql-language-server not found"));
  server = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
  server.stdout?.on("data", onData);
  server.on("exit", () => {
    server = null;
    initialized = null;
    pending.clear();
    buffer = Buffer.alloc(0);
  });
  initialized = new Promise((resolve) => {
    id += 1;
    const initId = id;
    pending.set(initId, () => {
      send({ method: "initialized", params: {} });
      resolve();
    });
    send({
      id: initId,
      method: "initialize",
      params: {
        processId: process.pid,
        rootUri,
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false },
            completion: { completionItem: { snippetSupport: false } },
            hover: { contentFormat: ["markdown", "plaintext"] },
            publishDiagnostics: {},
            signatureHelp: {},
          },
          workspace: { workspaceFolders: true },
        },
        workspaceFolders: rootUri
          ? [{ uri: rootUri, name: "workspace" }]
          : null,
      },
    });
  });
  return initialized;
}

/** Notification (didOpen / didChange / didClose). Starts + initializes the server lazily. */
export async function surqlNotify(
  method: string,
  params: unknown,
  rootUri?: string | null,
): Promise<void> {
  await ensureServer(rootUri ?? null);
  send({ method, params });
}

/** Request (completion / hover / signatureHelp / definition). */
export async function surqlRequest(
  method: string,
  params: unknown,
  rootUri?: string | null,
): Promise<LspMessage> {
  await ensureServer(rootUri ?? null);
  id += 1;
  const myId = id;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    send({ id: myId, method, params });
    setTimeout(() => {
      if (pending.delete(myId)) resolve({ result: null });
    }, 8000);
  });
}

export function stopSurqlLsp(): void {
  server?.kill();
  server = null;
  initialized = null;
  pending.clear();
}
