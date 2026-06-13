// Verifies Slice 2: opening a .ts schema file generates live SurrealQL in the
// contextual output pane (main-process jiti + surreal-zod emit over IPC).
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const schemaFile = resolve(
  appDir,
  "../example-git/database/schema/tables/user.ts",
);
const schemaDir = dirname(schemaFile);

const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir, "--no-sandbox", "--disable-gpu"],
  cwd: appDir,
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("[pageerror]", e.message));

await win.waitForSelector(".editor-empty-title");

// Open the schema file through the store (same path as Cmd+O).
await win.evaluate(
  async ([dir, file]) => {
    await window.studio.fs.addRoot(dir);
    await window.__studio.getState().openFilePath(file);
  },
  [schemaDir, schemaFile],
);
await win.waitForSelector(".file-tab.active");

const tab = await win.evaluate(
  () => document.querySelector(".file-tab.active .file-tab-name")?.textContent,
);
const paneType = await win.evaluate(
  () => document.querySelector(".pane-title-text")?.textContent,
);
console.log("active tab:", tab, "| output type:", paneType);

// Wait for the read-only preview editor to mount, then let codegen land.
await win.waitForSelector(".output-panel .monaco-editor");
await win.waitForTimeout(2500);
const ddl = await win.evaluate(
  () => document.querySelector(".output-panel .view-lines")?.textContent ?? "",
);
const err = await win.evaluate(
  () =>
    document.querySelector(".output-panel .result-error")?.textContent ?? "",
);
// Monaco renders spaces as non-breaking; normalize before asserting.
const norm = ddl.replace(/\s+/g, " ");
console.log("error:", err || "(none)");
console.log("DEFINE TABLE user:", norm.includes("DEFINE TABLE user"));
console.log(
  "datetime field (native codec ok):",
  norm.includes("TYPE datetime"),
);
console.log("email field:", norm.includes("email"));

// Source map drives cursor sync (true position mapping).
const mapLen = await win.evaluate(
  () => window.__studio.getState().codegenMap.length,
);
console.log("source map entries:", mapLen);

// Clause-level links present (TYPE / ASSERT / DEFAULT spans, not just FULL).
const clauses = await win.evaluate(() => [
  ...new Set(window.__studio.getState().codegenMap.map((l) => l.clause)),
]);
console.log("clauses mapped:", clauses.sort().join(","));

// surql`` drill-in (Phase 2): the template body maps to the inlined expr, sans clause keyword.
const drill = await win.evaluate(() => {
  const m = window.__studio
    .getState()
    .codegenMap.find((l) => l.clause.endsWith(":expr"));
  if (!m) return null;
  const eds = window.__monaco.editor.getEditors();
  const get = (uriTs, s) => {
    const ed = eds.find((e) =>
      uriTs
        ? e.getModel()?.uri.path.endsWith(".ts")
        : !e.getModel()?.uri.path.endsWith(".ts"),
    );
    return ed.getModel().getValueInRange({
      startLineNumber: s.startLine,
      startColumn: s.startCol,
      endLineNumber: s.endLine,
      endColumn: s.endCol,
    });
  };
  return { clause: m.clause, src: get(true, m.source), gen: get(false, m.gen) };
});
console.log(
  "drill-in:",
  drill
    ? `${drill.clause} src=${JSON.stringify(drill.src)} gen=${JSON.stringify(drill.gen)} match=${drill.src === drill.gen}`
    : "(none)",
);

// Forward: put the editor cursor inside a clause source span -> preview marks the gen span.
const fwd = await win.evaluate(() => {
  const m = window.__studio
    .getState()
    .codegenMap.find((l) => l.clause !== "FULL");
  if (!m) return false;
  const eds = window.__monaco.editor.getEditors();
  const src = eds.find((e) => e.getModel()?.uri.path.endsWith(".ts"));
  src.setPosition({
    lineNumber: m.source.startLine,
    column: m.source.startCol,
  });
  src.focus();
  return true;
});
await win.waitForTimeout(300);
console.log(
  "forward (editor->preview) highlight:",
  await win.evaluate(
    () => !!document.querySelector(".output-panel .linked-range"),
  ),
  "| triggered:",
  fwd,
);

// Reverse: put the preview cursor inside a clause gen span -> editor marks the source span.
await win.evaluate(() => {
  const m = window.__studio
    .getState()
    .codegenMap.find((l) => l.clause !== "FULL");
  const eds = window.__monaco.editor.getEditors();
  const prev = eds.find((e) => !e.getModel()?.uri.path.endsWith(".ts"));
  prev.setPosition({ lineNumber: m.gen.startLine, column: m.gen.startCol });
  prev.focus();
});
await win.waitForTimeout(300);
console.log(
  "reverse (preview->editor) highlight:",
  await win.evaluate(
    () => !!document.querySelector(".editor-host .linked-range"),
  ),
);

await win.screenshot({ path: "/tmp/sz-codegen.png" });
await app.close();
console.log("done");
