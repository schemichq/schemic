// Monaco wiring for Electron/Vite: bundle the workers locally (no CDN), point
// @monaco-editor/react at the local monaco, register a minimal SurrealQL
// language, and define the Reverie brand theme.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { SurqlLanguageService } from "../adapters/lsp/SurqlLanguageService";
import { SurqlTemplateLanguageService } from "../adapters/lsp/SurqlTemplateLanguageService";
import { getLanguageService } from "../runtime";

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less")
      return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor")
      return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

// Minimal SurrealQL language (highlighting only for now; LSP comes later).
export const SURQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "ORDER",
  "BY",
  "GROUP",
  "LIMIT",
  "START",
  "FETCH",
  "SPLIT",
  "AS",
  "ASC",
  "DESC",
  "AND",
  "OR",
  "NOT",
  "IN",
  "CONTAINS",
  "CREATE",
  "UPDATE",
  "DELETE",
  "RELATE",
  "INSERT",
  "UPSERT",
  "CONTENT",
  "SET",
  "MERGE",
  "RETURN",
  "DEFINE",
  "TABLE",
  "FIELD",
  "INDEX",
  "EVENT",
  "FUNCTION",
  "ACCESS",
  "ON",
  "TYPE",
  "ASSERT",
  "DEFAULT",
  "VALUE",
  "PERMISSIONS",
  "SCHEMAFULL",
  "SCHEMALESS",
  "UNIQUE",
  "FLEXIBLE",
  "IF",
  "ELSE",
  "FOR",
  "LET",
  "BEGIN",
  "COMMIT",
  "TRANSACTION",
  "WITH",
  "INFO",
];

if (!monaco.languages.getLanguages().some((l) => l.id === "surrealql")) {
  monaco.languages.register({ id: "surrealql" });
  monaco.languages.setMonarchTokensProvider("surrealql", {
    ignoreCase: true,
    keywords: SURQL_KEYWORDS,
    tokenizer: {
      root: [
        [/--.*$/, "comment"],
        [/#.*$/, "comment"],
        [/->|<-|<->/, "operator.graph"],
        [/[a-zA-Z_]\w*(?=::)/, "predefined"],
        [/::[a-zA-Z_]\w*/, "predefined"],
        [
          /[a-zA-Z_]\w*/,
          { cases: { "@keywords": "keyword", "@default": "identifier" } },
        ],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/\d+(\.\d+)?/, "number"],
        [/[;,.]/, "delimiter"],
        [/[<>=!+\-*/%]+/, "operator"],
      ],
    },
  });
}

monaco.editor.defineTheme("reverie-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "d8d3e4" },
    { token: "comment", foreground: "5d5670", fontStyle: "italic" },
    { token: "keyword", foreground: "c77dff" },
    { token: "operator", foreground: "aaa1bb" },
    { token: "operator.graph", foreground: "7bd0ff" },
    { token: "predefined", foreground: "7bd0ff" },
    { token: "string", foreground: "ff85d6" },
    { token: "number", foreground: "9fe3b0" },
    { token: "type", foreground: "9fe3b0" },
    { token: "identifier", foreground: "d8d3e4" },
    { token: "delimiter", foreground: "aaa1bb" },
  ],
  colors: {
    "editor.background": "#100d18",
    "editor.foreground": "#d8d3e4",
    "editorLineNumber.foreground": "#5d5670",
    "editorLineNumber.activeForeground": "#aaa1bb",
    "editor.lineHighlightBackground": "#ffffff08",
    "editor.selectionBackground": "#9600ff40",
    "editorCursor.foreground": "#c77dff",
    "editorIndentGuide.background1": "#211b2d",
    "editorWidget.background": "#16131f",
    "editorWidget.border": "#2a2438",
    "input.background": "#13101c",
    focusBorder: "#9600ff",
  },
});

// Install the language service for TS/JS schema files: a real tsserver on desktop, or the
// bundled-types fallback in the web/embedded build. (See adapters/LanguageService.)
getLanguageService().install(monaco);

// SurrealQL intelligence via the surrealql-language-server, when the binary is present
// (desktop only): completion / hover / diagnostics for .surql files AND inside surql`...`
// templates in TS/JS schema files (via masked virtual docs). Highlighting stays Monarch.
const surql = window.studio?.surql;
if (surql) {
  surql.available().then((ok) => {
    if (!ok) return;
    new SurqlLanguageService(surql).install(monaco);
    new SurqlTemplateLanguageService(surql).install(monaco);
  });
}

loader.config({ monaco });

// Dev/e2e seam: expose monaco for inspection + automation.
(window as unknown as { __monaco?: typeof monaco }).__monaco = monaco;
