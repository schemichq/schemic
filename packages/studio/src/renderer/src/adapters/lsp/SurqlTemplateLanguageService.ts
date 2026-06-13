import type * as Monaco from "monaco-editor";
import { type SurqlRegion, surqlRegions } from "../../monaco/surqlRegions";
import { useStudio } from "../../store";

// SurrealQL intelligence INSIDE surql`...` tagged templates in TS/JS schema files, backed by
// the surrealql-language-server. We keep a parallel "masked" surql document per TS model: the
// TS text with everything outside surql`` bodies replaced by spaces (newlines preserved), at a
// synthetic URI. That gives 1:1 positions, so completion / hover map straight back with no
// translation. Providers register on typescript/javascript but only fire when the cursor is
// inside a surql body (otherwise they defer to tsserver).
//
// Diagnostics are intentionally NOT surfaced here: the templates hold SurrealQL *expressions*
// (`time::now()`, `crypto::bcrypt::generate($value)`), but the masked doc concatenates them as
// if they were statements, so the parser flags the gaps between fragments. The server has no
// expression-context mode, so any diagnostics would mislead. (.surql files keep diagnostics via
// SurqlLanguageService.) Real per-fragment validation is a follow-up.

type Surql = NonNullable<Window["studio"]>["surql"];
type LspCompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  insertText?: string;
  sortText?: string;
  documentation?: string | { value: string };
};
type LspMarkup = string | { language?: string; value: string; kind?: string };

const EMBEDDED_SUFFIX = "__embedded__.surql";
const TS_LANGS = new Set(["typescript", "javascript"]);

function rootUri(): string | null {
  const root = useStudio.getState().workspaceRoot;
  return root ? `file://${root}` : null;
}

function embeddedUri(model: Monaco.editor.ITextModel): string {
  return `file://${model.uri.path}${EMBEDDED_SUFFIX}`;
}

// Replace every char outside a surql body with a space, preserving newlines so line/column
// positions are identical to the TS document.
function maskSurql(text: string, regions: SurqlRegion[]): string {
  const inBody = new Uint8Array(text.length);
  for (const r of regions)
    for (let i = r.bodyStart; i < r.bodyEnd && i < text.length; i++)
      inBody[i] = 1;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    out += inBody[i] || c === "\n" || c === "\r" ? c : " ";
  }
  return out;
}

function markupToMarkdown(c: LspMarkup): string {
  if (typeof c === "string") return c;
  if (c.language) return `\`\`\`${c.language}\n${c.value}\n\`\`\``;
  return c.value;
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

export class SurqlTemplateLanguageService {
  readonly id = "surrealql-template-lsp";
  private surql: Surql;
  private versions = new Map<string, number>();

  constructor(surql: Surql) {
    this.surql = surql;
  }

  install(monaco: typeof Monaco): void {
    this.syncModels(monaco);
    this.registerProviders(monaco);
  }

  private isTsModel(m: Monaco.editor.ITextModel): boolean {
    return TS_LANGS.has(m.getLanguageId());
  }

  // Open / change / close the masked virtual doc, reconciling against the current regions.
  // Returns the regions found (so callers can early-out when the cursor isn't in a body).
  private sync(m: Monaco.editor.ITextModel): SurqlRegion[] {
    const text = m.getValue();
    const regions = surqlRegions(text);
    const uri = embeddedUri(m);
    if (regions.length === 0) {
      if (this.versions.has(uri)) {
        this.surql.notify(
          "textDocument/didClose",
          { textDocument: { uri } },
          rootUri(),
        );
        this.versions.delete(uri);
      }
      return regions;
    }
    const masked = maskSurql(text, regions);
    if (!this.versions.has(uri)) {
      this.versions.set(uri, 1);
      this.surql.notify(
        "textDocument/didOpen",
        {
          textDocument: {
            uri,
            languageId: "surrealql",
            version: 1,
            text: masked,
          },
        },
        rootUri(),
      );
    } else {
      const version = (this.versions.get(uri) ?? 1) + 1;
      this.versions.set(uri, version);
      this.surql.notify(
        "textDocument/didChange",
        {
          textDocument: { uri, version },
          contentChanges: [{ text: masked }],
        },
        rootUri(),
      );
    }
    return regions;
  }

  private inBody(regions: SurqlRegion[], offset: number): boolean {
    return regions.some((r) => offset >= r.bodyStart && offset <= r.bodyEnd);
  }

  private syncModels(monaco: typeof Monaco): void {
    const attach = (m: Monaco.editor.ITextModel) => {
      if (!this.isTsModel(m)) return;
      this.sync(m);
      m.onDidChangeContent(() => {
        if (this.isTsModel(m)) this.sync(m);
      });
    };
    for (const m of monaco.editor.getModels()) attach(m);
    monaco.editor.onDidCreateModel(attach);
    monaco.editor.onWillDisposeModel((m) => {
      const uri = embeddedUri(m);
      if (this.versions.has(uri)) {
        this.surql.notify(
          "textDocument/didClose",
          { textDocument: { uri } },
          rootUri(),
        );
        this.versions.delete(uri);
      }
    });
  }

  private registerProviders(monaco: typeof Monaco): void {
    const self = this;
    const completion: Monaco.languages.CompletionItemProvider = {
      triggerCharacters: [".", ":", "<", "$", "(", " "],
      async provideCompletionItems(model, position) {
        const regions = self.sync(model); // freshest content before the request
        const offset = model.getOffsetAt(position);
        if (!self.inBody(regions, offset)) return { suggestions: [] };
        const res = (await self.surql.request(
          "textDocument/completion",
          {
            textDocument: { uri: embeddedUri(model) },
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
    };

    const hover: Monaco.languages.HoverProvider = {
      async provideHover(model, position) {
        const regions = self.sync(model);
        if (!self.inBody(regions, model.getOffsetAt(position))) return null;
        const res = (await self.surql.request(
          "textDocument/hover",
          {
            textDocument: { uri: embeddedUri(model) },
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
        return { contents: arr.map((c) => ({ value: markupToMarkdown(c) })) };
      },
    };

    for (const lang of TS_LANGS) {
      monaco.languages.registerCompletionItemProvider(lang, completion);
      monaco.languages.registerHoverProvider(lang, hover);
    }
  }
}
