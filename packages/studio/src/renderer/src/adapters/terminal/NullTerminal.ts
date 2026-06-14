import type { Terminal, TerminalEvent } from "../Terminal";

// Web/playground fallback: no terminal backend. The pane shows an unavailable state.
export class NullTerminal implements Terminal {
  readonly id = "null-terminal";
  readonly available = false;
  run(): void {}
  signal(): void {}
  dispose(): void {}
  onEvent(_cb: (e: TerminalEvent) => void): () => void {
    return () => {};
  }
}
