import type * as Monaco from "monaco-editor";
import { useStudio } from "../../store";
import type { LanguageService } from "../LanguageService";

// SurrealQL intelligence for .surql files, backed by the surrealql-language-server (a real
// stdio LSP in the main process, see src/main/surqlLsp.ts). Registers Monaco completion /
// hover / signature-help providers + diagnostics for the `surrealql` language and mirrors
// model lifecycle (didOpen / didChange full / didClose). Highlighting stays Monarch — the
// server has no semanticTokens. Only installed when the binary is present.

type Surql = NonNullable<Window["studio"]>["surql"];
type LspPos = { line: number; character: number };
type LspRange = { start: LspPos; end: LspPos };

function rootUri(): string | null {
  const root = useStudio.getState().workspaceRoot;
  return root ? `file://${root}` : null;
}

function toUri(model: Monaco.editor.ITextModel): string {
  return `file://${model.uri.path}`;
}

// LSP CompletionItemKind (1..25) -> Monaco CompletionItemKind.
function completionKind(
  monaco: typeof Monaco,
  n: number | undefined,
): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  const map: Record<number, Monaco.languages.CompletionItemKind> = {
    1: K.Text,
    2: K.Method,
    3: K.Function,
    4: K.Constructor,
    5: K.Field,
    6: K.Variable,
    7: K.Class,
    8: K.Interface,
    9: K.Module,
    10: K.Property,
    11: K.Unit,
    12: K.Value,
    13: K.Enum,
    14: K.Keyword,
    15: K.Snippet,
    16: K.Color,
    17: K.File,
    18: K.Reference,
    19: K.Folder,
    20: K.EnumMember,
    21: K.Constant,
    22: K.Struct,
    23: K.Event,
    24: K.Operator,
    25: K.TypeParameter,
  };
  return (n && map[n]) ?? K.Property;
}

type LspCompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  insertText?: string;
  sortText?: string;
  documentation?: string | { value: string };
};
type LspMarkup = string | { language?: string; value: string; kind?: string };
type LspDiagnostic = { range: LspRange; message: string; severity?: number };

function markupToMarkdown(c: LspMarkup): string {
  if (typeof c === "string") return c;
  if (c.language) return `\`\`\`${c.language}\n${c.value}\n\`\`\``;
  return c.value;
}

export class SurqlLanguageService implements LanguageService {
  readonly id = "surrealql-lsp";
  private surql: Surql;
  private versions = new Map<string, number>();

  constructor(surql: Surql) {
    this.surql = surql;
  }

  install(monaco: typeof Monaco): void {
    this.syncModels(monaco);
    this.registerProviders(monaco);
    this.wireDiagnostics(monaco);
  }

  private isSurqlFile(m: Monaco.editor.ITextModel): boolean {
    return m.getLanguageId() === "surrealql" && m.uri.path.endsWith(".surql");
  }

  private syncModels(monaco: typeof Monaco): void {
    const open = (m: Monaco.editor.ITextModel) => {
      const uri = toUri(m);
      this.versions.set(uri, 1);
      this.surql.notify(
        "textDocument/didOpen",
        {
          textDocument: {
            uri,
            languageId: "surrealql",
            version: 1,
            text: m.getValue(),
          },
        },
        rootUri(),
      );
      m.onDidChangeContent(() => {
        const version = (this.versions.get(uri) ?? 1) + 1;
        this.versions.set(uri, version);
        this.surql.notify(
          "textDocument/didChange",
          {
            textDocument: { uri, version },
            contentChanges: [{ text: m.getValue() }],
          },
          rootUri(),
        );
      });
    };
    for (const m of monaco.editor.getModels()) if (this.isSurqlFile(m)) open(m);
    monaco.editor.onDidCreateModel((m) => {
      if (this.isSurqlFile(m)) open(m);
    });
    monaco.editor.onWillDisposeModel((m) => {
      if (this.isSurqlFile(m))
        this.surql.notify(
          "textDocument/didClose",
          { textDocument: { uri: toUri(m) } },
          rootUri(),
        );
    });
  }

  private registerProviders(monaco: typeof Monaco): void {
    const surql = this.surql;
    monaco.languages.registerCompletionItemProvider("surrealql", {
      triggerCharacters: [".", ":", "<", "$", "("],
      async provideCompletionItems(model, position) {
        const res = (await surql.request(
          "textDocument/completion",
          {
            textDocument: { uri: toUri(model) },
            position: {
              line: position.lineNumber - 1,
              character: position.column - 1,
            },
          },
          rootUri(),
        )) as {
          result?: LspCompletionItem[] | { items?: LspCompletionItem[] };
        };
        const r = res?.result;
        const items = Array.isArray(r) ? r : (r?.items ?? []);
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: items.map((it) => ({
            label: it.label,
            kind: completionKind(monaco, it.kind),
            insertText: it.insertText ?? it.label,
            sortText: it.sortText,
            detail: it.detail,
            documentation:
              typeof it.documentation === "string"
                ? it.documentation
                : it.documentation?.value,
            range,
          })),
        };
      },
    });

    monaco.languages.registerHoverProvider("surrealql", {
      async provideHover(model, position) {
        const res = (await surql.request(
          "textDocument/hover",
          {
            textDocument: { uri: toUri(model) },
            position: {
              line: position.lineNumber - 1,
              character: position.column - 1,
            },
          },
          rootUri(),
        )) as { result?: { contents?: LspMarkup | LspMarkup[] } };
        const contents = res?.result?.contents;
        if (!contents) return null;
        const arr = Array.isArray(contents) ? contents : [contents];
        return {
          contents: arr.map((c) => ({ value: markupToMarkdown(c) })),
        };
      },
    });
  }

  private wireDiagnostics(monaco: typeof Monaco): void {
    this.surql.onEvent((raw) => {
      const msg = raw as {
        method?: string;
        params?: { uri?: string; diagnostics?: LspDiagnostic[] };
      };
      if (msg.method !== "textDocument/publishDiagnostics") return;
      const uri = msg.params?.uri;
      if (!uri) return;
      const path = uri.replace(/^file:\/\//, "");
      const model = monaco.editor.getModels().find((m) => m.uri.path === path);
      if (!model) return;
      const markers = (msg.params?.diagnostics ?? []).map((d) => ({
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        message: d.message,
        severity:
          d.severity === 1
            ? monaco.MarkerSeverity.Error
            : d.severity === 2
              ? monaco.MarkerSeverity.Warning
              : d.severity === 3
                ? monaco.MarkerSeverity.Info
                : monaco.MarkerSeverity.Hint,
      }));
      monaco.editor.setModelMarkers(model, "surrealql-lsp", markers);
    });
  }
}
