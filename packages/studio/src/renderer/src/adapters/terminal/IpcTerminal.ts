import type { Terminal, TerminalEvent } from "../Terminal";

// Desktop terminal: forwards to the main-process command runner over IPC (see src/main/terminal.ts).
export class IpcTerminal implements Terminal {
  readonly id = "ipc-terminal";
  readonly available = true;
  private bridge = window.studio?.terminal;

  run(id: string, line: string, cwd: string): void {
    this.bridge?.run(id, line, cwd);
  }
  signal(id: string, signal: string): void {
    this.bridge?.signal(id, signal);
  }
  dispose(id: string): void {
    this.bridge?.dispose(id);
  }
  onEvent(cb: (e: TerminalEvent) => void): () => void {
    return this.bridge?.onEvent(cb as (e: unknown) => void) ?? (() => {});
  }
}
