import { type ChildProcess, fork } from "node:child_process";
import { createRequire } from "node:module";

// Real TypeScript language service: we run `tsserver` (the same engine VSCode talks to)
// as a child process with `--useNodeIpc`, so it reads the opened project's tsconfig +
// node_modules straight from disk — true types/autocomplete, not Monaco's sandboxed worker.
// The renderer drives it over IPC (see src/main/index.ts). (Engine bridge / LSP.)

const require = createRequire(import.meta.url);

export type TsMessage = { type: string; [key: string]: unknown };

let server: ChildProcess | null = null;
let seq = 0;
const pending = new Map<number, (msg: TsMessage) => void>();
let eventSink: ((msg: TsMessage) => void) | null = null;

/** Route tsserver events (diagnostics, etc.) to the renderer. */
export function setTsEventSink(fn: (msg: TsMessage) => void): void {
  eventSink = fn;
}

function ensureServer(): ChildProcess {
  if (server) return server;
  const tsserverPath = require.resolve("typescript/lib/tsserver.js");
  server = fork(tsserverPath, ["--useNodeIpc"], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  server.on("message", (msg: TsMessage) => {
    if (msg.type === "response" && typeof msg.request_seq === "number") {
      const cb = pending.get(msg.request_seq);
      if (cb) {
        pending.delete(msg.request_seq);
        cb(msg);
      }
    } else if (msg.type === "event") {
      eventSink?.(msg);
    }
  });
  server.on("exit", () => {
    server = null;
    pending.clear();
  });
  return server;
}

/** Fire-and-forget command (open / change / close / geterr — no direct response). */
export function tsNotify(command: string, args: unknown): void {
  seq += 1;
  ensureServer().send({ seq, type: "request", command, arguments: args });
}

/** Request/response command (completionInfo / quickinfo / definition / ...). */
export function tsRequest(command: string, args: unknown): Promise<TsMessage> {
  const s = ensureServer();
  seq += 1;
  const mySeq = seq;
  return new Promise((resolve) => {
    pending.set(mySeq, resolve);
    s.send({ seq: mySeq, type: "request", command, arguments: args });
    setTimeout(() => {
      if (pending.delete(mySeq)) {
        resolve({
          type: "response",
          success: false,
          message: "tsserver timeout",
        });
      }
    }, 8000);
  });
}

export function stopTsServer(): void {
  server?.kill();
  server = null;
  pending.clear();
}
