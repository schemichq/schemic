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

// Forward: move the editor cursor to a mapped source line -> preview marks the gen line.
const fwd = await win.evaluate(() => {
  const m = window.__studio.getState().codegenMap.find((e) => e.sourceLine > 0);
  if (!m) return false;
  const eds = window.__monaco.editor.getEditors();
  const src = eds.find((e) => e.getModel()?.uri.path.endsWith(".ts"));
  src.setPosition({ lineNumber: m.sourceLine, column: 1 });
  src.focus();
  return true;
});
await win.waitForTimeout(300);
console.log(
  "forward (editor->preview) highlight:",
  await win.evaluate(
    () => !!document.querySelector(".output-panel .linked-line"),
  ),
  "| triggered:",
  fwd,
);

// Reverse: move the preview cursor to a mapped gen line -> editor marks the source line.
await win.evaluate(() => {
  const m = window.__studio.getState().codegenMap.find((e) => e.genLine > 1);
  const eds = window.__monaco.editor.getEditors();
  const prev = eds.find((e) => !e.getModel()?.uri.path.endsWith(".ts"));
  prev.setPosition({ lineNumber: m.genLine, column: 1 });
  prev.focus();
});
await win.waitForTimeout(300);
console.log(
  "reverse (preview->editor) highlight:",
  await win.evaluate(
    () => !!document.querySelector(".editor-host .linked-line"),
  ),
);

await win.screenshot({ path: "/tmp/sz-codegen.png" });
await app.close();
console.log("done");
