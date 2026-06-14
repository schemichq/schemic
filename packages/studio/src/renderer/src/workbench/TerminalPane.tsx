import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { getTerminal } from "../runtime";
import { useStudio } from "../store";

// Integrated terminal (dock pane, variant B): an xterm view over the command-runner adapter.
// We draw the prompt and handle line editing locally (echo / backspace / Ctrl+C), send whole
// command lines to the main-process runner, and stream its output back. One command at a time.

const THEME = {
  background: "#100d18",
  foreground: "#d8d3e4",
  cursor: "#c77dff",
  selectionBackground: "#9600ff55",
  black: "#100d18",
  red: "#ff6b81",
  green: "#9fe3b0",
  yellow: "#ffb454",
  blue: "#7bd0ff",
  magenta: "#c77dff",
  cyan: "#7bd0ff",
  white: "#d8d3e4",
  brightBlack: "#5d5670",
  brightWhite: "#f5f3fa",
};

function basename(p: string): string {
  return (
    p
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || p
  );
}

export function TerminalPane() {
  const root = useStudio((s) => s.workspaceRoot);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const term = getTerminal();

  // biome-ignore lint/correctness/useExhaustiveDependencies: term is a stable singleton; root re-inits the session.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !root || !term.available) return;

    const id = crypto.randomUUID();
    const prompt = `\x1b[38;2;199;125;255m${basename(root)}\x1b[0m $ `;
    let line = "";
    let running = false;

    const xterm = new Xterm({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      convertEol: true, // program output uses \n; let xterm add the \r
      theme: THEME,
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(host);
    fit.fit();
    xterm.writeln(
      "\x1b[38;5;245mReverie terminal - run sz commands here.\x1b[0m",
    );
    xterm.write(prompt);

    xterm.onData((data) => {
      if (running) {
        if (data === "\x03") term.signal(id, "SIGINT"); // Ctrl+C kills the command
        return;
      }
      switch (data) {
        case "\r": {
          xterm.write("\n");
          const cmd = line.trim();
          line = "";
          if (cmd) {
            running = true;
            term.run(id, cmd, root);
          } else {
            xterm.write(prompt);
          }
          break;
        }
        case "\x7f": // backspace
          if (line.length > 0) {
            line = line.slice(0, -1);
            xterm.write("\b \b");
          }
          break;
        case "\x03": // Ctrl+C at the prompt
          xterm.write("^C\n");
          line = "";
          xterm.write(prompt);
          break;
        default:
          // Printable input only (ignore other control sequences for now).
          if (data >= " ") {
            line += data;
            xterm.write(data);
          }
      }
    });

    const off = term.onEvent((e) => {
      if (e.id !== id) return;
      if (e.type === "data") {
        xterm.write(e.chunk);
      } else {
        if (e.code) xterm.write(`\x1b[31m[exit ${e.code}]\x1b[0m\n`);
        running = false;
        xterm.write(prompt);
      }
    });

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(host);

    return () => {
      ro.disconnect();
      off();
      term.dispose(id);
      xterm.dispose();
    };
  }, [root]);

  if (!term.available) {
    return (
      <div className="preview-body">
        <div className="preview-pending">
          <p className="preview-pending-title">Terminal unavailable</p>
          <p className="preview-pending-sub">
            The web build has no shell. Open Reverie Studio on desktop to run{" "}
            <code>sz</code> commands.
          </p>
        </div>
      </div>
    );
  }
  if (!root) {
    return (
      <div className="preview-body">
        <div className="preview-pending">
          <p className="preview-pending-title">No project open</p>
          <p className="preview-pending-sub">
            Open a project folder to run <code>sz</code> commands in its
            directory.
          </p>
        </div>
      </div>
    );
  }
  return <div className="terminal-host" ref={hostRef} />;
}
