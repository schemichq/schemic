import { type ChildProcess, spawn } from "node:child_process";

// Command-runner terminal: runs one command line at a time per session via the user's shell,
// scoped to the project cwd, streaming stdout+stderr back to the renderer (which draws the
// prompt + handles line editing in xterm). This serves the core sz CLI loop (status / pull /
// push / generate / migrate) with no native dependency. A full interactive PTY (node-pty) is a
// localized upgrade behind this same IPC surface — swap the spawn here for a pty when needed.

export type TerminalEvent =
  | { type: "data"; id: string; chunk: string }
  | { type: "exit"; id: string; code: number | null };

let sink: ((e: TerminalEvent) => void) | null = null;
export function setTerminalEventSink(fn: (e: TerminalEvent) => void): void {
  sink = fn;
}

// One running child per session id (the renderer drives a single command at a time per pane).
const running = new Map<string, ChildProcess>();

/** Run `line` in `cwd` for session `id`. Ignored (with an exit code) if one is already running. */
export function terminalRun(id: string, line: string, cwd: string): void {
  if (running.has(id)) {
    sink?.({ type: "exit", id, code: null });
    return;
  }
  const child = spawn(line, {
    shell: true,
    cwd,
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  running.set(id, child);
  const onChunk = (b: Buffer) =>
    sink?.({ type: "data", id, chunk: b.toString("utf8") });
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);
  child.on("error", (err) => {
    sink?.({ type: "data", id, chunk: `${err.message}\r\n` });
  });
  child.on("close", (code) => {
    running.delete(id);
    sink?.({ type: "exit", id, code });
  });
}

/** Signal the running child (Ctrl+C -> SIGINT). No-op if nothing is running. */
export function terminalSignal(id: string, signal: NodeJS.Signals): void {
  running.get(id)?.kill(signal);
}

/** Kill + forget a session (pane closed). */
export function terminalDispose(id: string): void {
  running.get(id)?.kill("SIGKILL");
  running.delete(id);
}

/** Kill every session (app shutdown). */
export function terminalDisposeAll(): void {
  for (const child of running.values()) child.kill("SIGKILL");
  running.clear();
}
