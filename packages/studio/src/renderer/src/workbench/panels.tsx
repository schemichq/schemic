import Editor, { type Monaco } from "@monaco-editor/react";
import { FileCode, Play, X } from "lucide-react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { runCommand } from "../commands/registry";
import { getCodegen } from "../runtime";
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

  if (!active) {
    return (
      <div className="panel editor-panel">
        <div className="editor-empty">
          <p className="editor-empty-title">No file open</p>
          <p className="editor-empty-hint">
            Open a file from the Explorer to start editing.
          </p>
        </div>
      </div>
    );
  }

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
        {active.language === "surrealql" && (
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
        )}
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
            // Linked highlighting: publish the identifier under the cursor so the
            // SurrealQL preview can mark the matching DEFINE line.
            editor.onDidChangeCursorPosition((e) => {
              const word = editor.getModel()?.getWordAtPosition(e.position);
              useStudio.getState().setLinkedName(word?.word ?? null);
            });
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

type CodegenState = { loading: boolean; surql: string; error: string | null };

// Live codegen for the active schema file via the main-process engine bridge. Regenerates
// (debounced) from the in-memory editor buffer, so the preview tracks unsaved edits; the
// refresh button forces a re-run.
function useCodegen(doc: Doc | null, enabled: boolean) {
  const [state, setState] = useState<CodegenState>({
    loading: false,
    surql: "",
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const path = doc?.path;
  const content = doc?.content;
  const codegenable = !!doc && !doc.scratch;

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is an intentional manual re-run trigger (refresh button), not read in the body.
  useEffect(() => {
    if (!enabled || !codegenable || path === undefined || content === undefined)
      return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      getCodegen()
        .fromFile(path, content)
        .then((r) => {
          if (cancelled) return;
          setState({
            loading: false,
            surql: r.surql ?? "",
            error: r.ok ? null : (r.error ?? "codegen failed"),
          });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [enabled, codegenable, path, content, nonce]);

  return { ...state, refresh };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Read-only SurrealQL preview body (the editor is rendered by OutputPane's codegen state).
function SurrealqlPreview({
  doc,
  state,
}: {
  doc: Doc | null;
  state: CodegenState;
}) {
  const linkedName = useStudio((s) => s.linkedName);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const decoRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(
    null,
  );
  const [ready, setReady] = useState(false);

  // Linked highlighting: mark the DEFINE line matching the identifier under the
  // editor cursor (name-based — source positions aren't tracked by emit yet).
  // biome-ignore lint/correctness/useExhaustiveDependencies: state.surql (DDL changed) and ready (editor mounted) are intentional re-decorate triggers read via refs.
  useEffect(() => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    if (!ed || !model) return;
    if (!decoRef.current) decoRef.current = ed.createDecorationsCollection();
    if (!linkedName) {
      decoRef.current.clear();
      return;
    }
    const re = new RegExp(`^DEFINE (?:FIELD|TABLE) ${escapeRe(linkedName)}\\b`);
    let target = 0;
    for (let i = 1; i <= model.getLineCount(); i++) {
      if (re.test(model.getLineContent(i).trim())) {
        target = i;
        break;
      }
    }
    if (!target) {
      decoRef.current.clear();
      return;
    }
    decoRef.current.set([
      {
        range: {
          startLineNumber: target,
          startColumn: 1,
          endLineNumber: target,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: "linked-line",
          linesDecorationsClassName: "linked-glyph",
        },
      },
    ]);
    ed.revealLineInCenterIfOutsideViewport(target);
  }, [linkedName, state.surql, ready]);

  if (!doc || doc.scratch) {
    return (
      <div className="preview-body">
        <div className="preview-pending">
          <p className="preview-pending-title">Generated SurrealQL</p>
          <p className="preview-pending-sub">
            Open a <code>.ts</code> schema file to see its generated DDL.
          </p>
        </div>
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="preview-body">
        <div className="result-error">{state.error}</div>
      </div>
    );
  }
  if (!state.surql && !state.loading) {
    return (
      <div className="preview-body">
        <div className="preview-pending">
          <p className="preview-pending-title">No schema definitions</p>
          <p className="preview-pending-sub">
            <code>{doc.name}</code> doesn't export any <code>sz.*</code> tables
            or defs.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="preview-body">
      <Editor
        height="100%"
        language="surrealql"
        value={state.surql}
        theme="reverie-dark"
        onMount={(ed: MonacoEditor.IStandaloneCodeEditor, _m: Monaco) => {
          editorRef.current = ed;
          setReady(true);
        }}
        options={{
          readOnly: true,
          domReadOnly: true,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
          lineHeight: 21,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 12 },
          renderLineHighlight: "none",
          overviewRulerLanes: 0,
          fontLigatures: true,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        }}
      />
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

  const codegen = useCodegen(active, type === "surrealql");
  const canCopy = type === "surrealql" && !!codegen.surql;

  return (
    <div className="panel output-panel">
      <PaneHeader
        type={type}
        onSwitchType={setType}
        readOnly={type === "surrealql"}
        loading={type === "surrealql" && codegen.loading}
        onRefresh={type === "surrealql" ? codegen.refresh : undefined}
        onCopy={
          canCopy
            ? () => void navigator.clipboard.writeText(codegen.surql)
            : undefined
        }
      />
      {type === "result" && <ResultBody />}
      {type === "surrealql" && (
        <SurrealqlPreview doc={active} state={codegen} />
      )}
      {type === "terminal" && <TerminalBody />}
      {type === "problems" && <ProblemsBody />}
    </div>
  );
}
