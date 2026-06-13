import Editor from "@monaco-editor/react";
import { FileCode, Play, X } from "lucide-react";
import { useState } from "react";
import { runCommand } from "../commands/registry";
import { activeDoc, type Doc, useStudio } from "../store";
import { PaneHeader, type PaneType } from "./PaneHeader";

export function EditorPanel() {
  const docs = useStudio((s) => s.docs);
  const activePath = useStudio((s) => s.activePath);
  const setActivePath = useStudio((s) => s.setActivePath);
  const closeDoc = useStudio((s) => s.closeDoc);
  const setContent = useStudio((s) => s.setContent);
  const running = useStudio((s) => s.running);
  const active = useStudio(activeDoc);

  return (
    <div className="panel editor-panel">
      <div className="editor-tabs">
        <div className="tab-strip">
          {docs.map((d) => (
            <div
              key={d.path}
              className={`file-tab${d.path === activePath ? " active" : ""}`}
            >
              <button
                type="button"
                className="file-tab-main"
                onClick={() => setActivePath(d.path)}
              >
                <FileCode size={13} className="file-tab-icon" />
                <span className="file-tab-name">
                  {d.name}
                  {d.dirty ? " •" : ""}
                </span>
              </button>
              {!d.scratch && (
                <button
                  type="button"
                  className="file-tab-close"
                  title="Close"
                  onClick={() => closeDoc(d.path)}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="run-btn editor-run"
          onClick={() => runCommand("query.run")}
          disabled={running}
        >
          <Play size={13} />
          {running ? "Running…" : "Run"}
          <kbd className="run-kbd">⌘↵</kbd>
        </button>
      </div>
      <div className="editor-host">
        <Editor
          key={activePath ?? "empty"}
          height="100%"
          defaultLanguage={active?.language ?? "surrealql"}
          defaultValue={active?.content ?? ""}
          theme="reverie-dark"
          onChange={(v) => {
            if (activePath) setContent(activePath, v ?? "");
          }}
          onMount={(editor, monaco) => {
            editor.addCommand(
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
              () => {
                void runCommand("query.run");
              },
            );
            // Monaco swallows Cmd/Ctrl+K (chord prefix), so bind global shortcuts
            // inside the editor too, routed to the same commands.
            editor.addCommand(
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
              () => {
                void runCommand("command.palette");
              },
            );
            editor.addCommand(
              monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
              () => {
                void runCommand("command.palette");
              },
            );
          }}
          options={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            lineHeight: 21,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 12 },
            renderLineHighlight: "line",
            smoothScrolling: true,
            tabSize: 2,
            fontLigatures: true,
            overviewRulerLanes: 0,
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
          }}
        />
      </div>
    </div>
  );
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const s = String(v);
    return s === "[object Object]" ? JSON.stringify(v) : s;
  }
  return String(v);
}

function ResultTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const cols: string[] = [];
  for (const r of rows)
    for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return (
    <div className="result-scroll">
      <table className="result-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable key guaranteed
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} className={c === "id" ? "cell-id" : ""}>
                  {cell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultBody() {
  const outcome = useStudio((s) => s.outcome);
  const running = useStudio((s) => s.running);
  const [format, setFormat] = useState<"Table" | "JSON">("Table");

  const last = outcome?.ok ? outcome.statements.at(-1)?.result : undefined;
  const rows =
    Array.isArray(last) && last.every((x) => x && typeof x === "object")
      ? (last as Array<Record<string, unknown>>)
      : null;
  const meta = outcome?.ok
    ? `${rows ? rows.length : 1} ${rows && rows.length === 1 ? "row" : "rows"} · ${outcome.elapsedMs.toFixed(0)} ms`
    : outcome
      ? "error"
      : "ready";

  return (
    <div className="result-body">
      <div className="result-subbar">
        <span className="result-meta">{running ? "running…" : meta}</span>
        <button
          type="button"
          className="format-dropdown"
          onClick={() => setFormat((f) => (f === "Table" ? "JSON" : "Table"))}
        >
          {format}
        </button>
      </div>
      {!outcome && !running && (
        <div className="result-empty">Run a query (⌘↵) to see results.</div>
      )}
      {outcome && !outcome.ok && (
        <div className="result-error">{outcome.error}</div>
      )}
      {outcome?.ok &&
        (format === "JSON" ? (
          <pre className="result-json">{JSON.stringify(last, null, 2)}</pre>
        ) : rows ? (
          <ResultTable rows={rows} />
        ) : (
          <pre className="result-json">{JSON.stringify(last, null, 2)}</pre>
        ))}
    </div>
  );
}

// Generated-SurrealQL preview for a schema file. Live codegen lands with the
// main-process engine bridge (Slice 2); for now the pane is honest about that.
function SurrealqlPreview({ doc }: { doc: Doc | null }) {
  return (
    <div className="preview-body">
      <div className="preview-pending">
        <p className="preview-pending-title">Generated SurrealQL</p>
        <p className="preview-pending-sub">
          Live DDL for <code>{doc?.name ?? "this file"}</code> is generated by
          the surreal-zod engine. Wiring lands with the main-process engine
          bridge.
        </p>
      </div>
    </div>
  );
}

function TerminalBody() {
  return (
    <div className="preview-body">
      <div className="preview-pending">
        <p className="preview-pending-title">Terminal</p>
        <p className="preview-pending-sub">
          Live <code>sz</code> CLI output streams here once the terminal adapter
          lands.
        </p>
      </div>
    </div>
  );
}

function ProblemsBody() {
  return (
    <div className="preview-body">
      <div className="preview-pending">
        <p className="preview-pending-title">No problems</p>
        <p className="preview-pending-sub">
          Diagnostics appear here when schemas fail to validate.
        </p>
      </div>
    </div>
  );
}

/** Default output pane type for a document's language. */
function defaultTypeFor(language: string | undefined): PaneType {
  return language === "typescript" || language === "javascript"
    ? "surrealql"
    : "result";
}

// Output pane is contextual to the active file: switching files re-derives the
// default type, but the user can override it (in place) via the header dropdown.
export function OutputPane() {
  const active = useStudio(activeDoc);
  const wanted = defaultTypeFor(active?.language);
  const [type, setType] = useState<PaneType>(wanted);
  const [contextType, setContextType] = useState<PaneType>(wanted);
  if (wanted !== contextType) {
    setContextType(wanted);
    setType(wanted);
  }

  return (
    <div className="panel output-panel">
      <PaneHeader
        type={type}
        onSwitchType={setType}
        readOnly={type === "surrealql"}
      />
      {type === "result" && <ResultBody />}
      {type === "surrealql" && <SurrealqlPreview doc={active} />}
      {type === "terminal" && <TerminalBody />}
      {type === "problems" && <ProblemsBody />}
    </div>
  );
}
