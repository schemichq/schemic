import type * as Monaco from "monaco-editor";
import type { LanguageService } from "../LanguageService";

// Desktop language service backed by a real tsserver (main process, see src/main/lsp.ts).
// Monaco's built-in TS worker is disabled; completion / hover / diagnostics and doc sync
// all flow to tsserver over IPC, so the opened project's node_modules + tsconfig drive
// real types — the same engine VSCode uses.

type Lsp = NonNullable<Window["studio"]>["lsp"];

const TS_LANGS = ["typescript", "javascript"];

function scriptKind(path: string): string {
  if (path.endsWith(".tsx")) return "TSX";
  if (path.endsWith(".jsx")) return "JSX";
  if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".cts"))
    return "TS";
  return "JS";
}

function completionKind(
  monaco: typeof Monaco,
  kind: string,
): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "method":
      return K.Method;
    case "property":
    case "getter":
    case "setter":
      return K.Field;
    case "function":
    case "local function":
      return K.Function;
    case "const":
    case "let":
    case "var":
    case "local var":
    case "parameter":
    case "alias":
      return K.Variable;
    case "class":
    case "local class":
      return K.Class;
    case "interface":
    case "type":
      return K.Interface;
    case "enum":
      return K.Enum;
    case "enum member":
      return K.EnumMember;
    case "module":
    case "external module name":
      return K.Module;
    case "keyword":
      return K.Keyword;
    case "string":
      return K.Constant;
    default:
      return K.Property;
  }
}

function markerSeverity(
  monaco: typeof Monaco,
  category: string,
): Monaco.MarkerSeverity {
  const S = monaco.MarkerSeverity;
  if (category === "error") return S.Error;
  if (category === "warning") return S.Warning;
  if (category === "suggestion") return S.Hint;
  return S.Info;
}

type TsPos = { line: number; offset: number };
type TsCompletionEntry = {
  name: string;
  kind: string;
  sortText: string;
  insertText?: string;
  source?: string;
};
type TsDiag = { start: TsPos; end: TsPos; text: string; category: string };

export class TsServerLanguageService implements LanguageService {
  readonly id = "tsserver";
  private lsp: Lsp;

  constructor(lsp: Lsp) {
    this.lsp = lsp;
  }

  install(monaco: typeof Monaco): void {
    this.disableBuiltinTs(monaco);
    this.syncModels(monaco);
    this.registerProviders(monaco);
    this.wireDiagnostics(monaco);
  }

  // Turn off Monaco's sandboxed TS worker — tsserver is authoritative.
  private disableBuiltinTs(monaco: typeof Monaco): void {
    const tsLang = monaco.languages as unknown as {
      typescript?: {
        typescriptDefaults: {
          setModeConfiguration(c: Record<string, boolean>): void;
          setDiagnosticsOptions(o: Record<string, boolean>): void;
        };
        javascriptDefaults: {
          setModeConfiguration(c: Record<string, boolean>): void;
          setDiagnosticsOptions(o: Record<string, boolean>): void;
        };
      };
    };
    const off = {
      completionItems: false,
      hovers: false,
      documentSymbols: false,
      definitions: false,
      references: false,
      documentHighlights: false,
      rename: false,
      diagnostics: false,
      signatureHelp: false,
      onTypeFormatting: false,
      codeActions: false,
      inlayHints: false,
    };
    const noValidate = {
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
    };
    for (const d of [
      tsLang.typescript?.typescriptDefaults,
      tsLang.typescript?.javascriptDefaults,
    ]) {
      d?.setModeConfiguration(off);
      d?.setDiagnosticsOptions(noValidate);
    }
  }

  private geterrTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private requestDiagnostics(file: string): void {
    const prev = this.geterrTimers.get(file);
    if (prev) clearTimeout(prev);
    this.geterrTimers.set(
      file,
      setTimeout(
        () => this.lsp.notify("geterr", { files: [file], delay: 0 }),
        400,
      ),
    );
  }

  // Mirror Monaco model lifecycle into tsserver (open / incremental change / close).
  private syncModels(monaco: typeof Monaco): void {
    const isTs = (m: Monaco.editor.ITextModel) =>
      TS_LANGS.includes(m.getLanguageId());

    const open = (m: Monaco.editor.ITextModel) => {
      const file = m.uri.path;
      this.lsp.notify("open", {
        file,
        fileContent: m.getValue(),
        scriptKindName: scriptKind(file),
      });
      this.requestDiagnostics(file);
      m.onDidChangeContent((e) => {
        for (const c of e.changes) {
          this.lsp.notify("change", {
            file,
            line: c.range.startLineNumber,
            offset: c.range.startColumn,
            endLine: c.range.endLineNumber,
            endOffset: c.range.endColumn,
            insertString: c.text,
          });
        }
        this.requestDiagnostics(file);
      });
    };

    for (const m of monaco.editor.getModels()) if (isTs(m)) open(m);
    monaco.editor.onDidCreateModel((m) => {
      if (isTs(m)) open(m);
    });
    monaco.editor.onWillDisposeModel((m) => {
      if (isTs(m)) this.lsp.notify("close", { file: m.uri.path });
    });
  }

  private registerProviders(monaco: typeof Monaco): void {
    const lsp = this.lsp;
    monaco.languages.registerCompletionItemProvider(TS_LANGS, {
      triggerCharacters: [".", '"', "'", "`", "/", "@", "<", " "],
      async provideCompletionItems(model, position) {
        const file = model.uri.path;
        const res = (await lsp.request("completionInfo", {
          file,
          line: position.lineNumber,
          offset: position.column,
        })) as { body?: { entries?: TsCompletionEntry[] } } | undefined;
        const entries = res?.body?.entries ?? [];
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: entries.map((e) => ({
            label: e.name,
            kind: completionKind(monaco, e.kind),
            insertText: e.insertText ?? e.name,
            sortText: e.sortText,
            range,
            // Stashed for resolveCompletionItem.
            _file: file,
            _pos: { line: position.lineNumber, offset: position.column },
            _source: e.source,
          })) as Monaco.languages.CompletionItem[],
        };
      },
      async resolveCompletionItem(item) {
        const it = item as Monaco.languages.CompletionItem & {
          _file?: string;
          _pos?: TsPos;
          _source?: string;
        };
        if (!it._file || !it._pos) return item;
        const res = (await lsp.request("completionEntryDetails", {
          file: it._file,
          line: it._pos.line,
          offset: it._pos.offset,
          entryNames: [
            it._source
              ? { name: it.label, source: it._source }
              : (it.label as string),
          ],
        })) as
          | {
              body?: Array<{
                displayParts?: Array<{ text: string }>;
                documentation?: Array<{ text: string }>;
              }>;
            }
          | undefined;
        const detail = res?.body?.[0];
        if (detail) {
          item.detail = (detail.displayParts ?? []).map((p) => p.text).join("");
          const doc = (detail.documentation ?? []).map((p) => p.text).join("");
          if (doc) item.documentation = { value: doc };
        }
        return item;
      },
    });

    monaco.languages.registerHoverProvider(TS_LANGS, {
      async provideHover(model, position) {
        const res = (await lsp.request("quickinfo", {
          file: model.uri.path,
          line: position.lineNumber,
          offset: position.column,
        })) as
          | { body?: { displayString?: string; documentation?: string } }
          | undefined;
        const b = res?.body;
        if (!b?.displayString) return null;
        const contents: Monaco.IMarkdownString[] = [
          { value: `\`\`\`typescript\n${b.displayString}\n\`\`\`` },
        ];
        if (b.documentation) contents.push({ value: b.documentation });
        return { contents };
      },
    });
  }

  private wireDiagnostics(monaco: typeof Monaco): void {
    this.lsp.onEvent((raw) => {
      const msg = raw as {
        event?: string;
        body?: { file?: string; diagnostics?: TsDiag[] };
      };
      if (
        msg.event !== "semanticDiag" &&
        msg.event !== "syntaxDiag" &&
        msg.event !== "suggestionDiag"
      )
        return;
      const file = msg.body?.file;
      if (!file) return;
      const model = monaco.editor.getModels().find((m) => m.uri.path === file);
      if (!model) return;
      const markers = (msg.body?.diagnostics ?? []).map((d) => ({
        startLineNumber: d.start.line,
        startColumn: d.start.offset,
        endLineNumber: d.end.line,
        endColumn: d.end.offset,
        message: d.text,
        severity: markerSeverity(monaco, d.category),
      }));
      monaco.editor.setModelMarkers(model, `tsserver-${msg.event}`, markers);
    });
  }
}
