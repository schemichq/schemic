// Capability interface: a command-runner terminal. On desktop this is IPC to a main-process
// shell runner; the web playground has no terminal (NullTerminal). The renderer draws the
// prompt + handles line editing in xterm and sends whole command lines here.

export type TerminalEvent =
  | { type: "data"; id: string; chunk: string }
  | { type: "exit"; id: string; code: number | null };

export interface Terminal {
  readonly id: string;
  /** Whether a real terminal backend is present (false in the web build). */
  readonly available: boolean;
  /** Run a command line for session `id` in `cwd`. Output streams back via onEvent. */
  run(id: string, line: string, cwd: string): void;
  /** Signal the running command (e.g. "SIGINT" for Ctrl+C). */
  signal(id: string, signal: string): void;
  /** Kill + forget a session (pane closed). */
  dispose(id: string): void;
  /** Subscribe to streamed output / exit events. Returns an unsubscribe fn. */
  onEvent(cb: (e: TerminalEvent) => void): () => void;
}
