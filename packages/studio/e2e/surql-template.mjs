// Verifies SurrealQL LSP intelligence INSIDE surql`...` templates in a .ts schema file,
// via the masked virtual document (1:1 positions).
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const file = resolve(appDir, "../example-git/database/schema/tables/user.ts");
const dir = dirname(file);

const app = await electron.launch({
  executablePath: require("electron"),
  args: [appDir, "--no-sandbox", "--disable-gpu"],
  cwd: appDir,
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("[pageerror]", e.message));
await win.waitForSelector(".editor-empty-title");

const avail = await win.evaluate(() => window.studio.surql.available());
console.log("surql LSP available:", avail);

await win.evaluate(
  async ([dir, file]) => {
    await window.studio.fs.addRoot(dir);
    await window.__studio.getState().openFilePath(file);
  },
  [dir, file],
);
await win.waitForSelector(".editor-host .monaco-editor");
await win.waitForTimeout(800);

// Position inside the surql body: right after `string::` in `string::is_email($value)`.
const pos = await win.evaluate(() => {
  const m = window.__monaco.editor
    .getModels()
    .find((x) => x.getLanguageId() === "typescript");
  const text = m.getValue();
  const marker = "string::";
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const at = idx + marker.length; // just after the `::`
  const p = m.getPositionAt(at);
  return { path: m.uri.path, line: p.lineNumber, col: p.column };
});
console.log("string:: body pos:", JSON.stringify(pos));

// Direct LSP path: request completion against the masked embedded doc.
let labels = [];
for (let i = 0; i < 20; i++) {
  const res = await win.evaluate(
    (p) =>
      window.studio.surql.request(
        "textDocument/completion",
        {
          textDocument: { uri: `file://${p.path}__embedded__.surql` },
          position: { line: p.line - 1, character: p.col - 1 },
        },
        window.__studio.getState().workspaceRoot
          ? `file://${window.__studio.getState().workspaceRoot}`
          : null,
      ),
    pos,
  );
  const r = res?.result;
  labels = (Array.isArray(r) ? r : (r?.items ?? [])).map((x) => x.label);
  if (labels.length) break;
  await win.waitForTimeout(400);
}
console.log("direct LSP completion count:", labels.length);
console.log(
  "has string:: fns:",
  labels.some((l) => /string/i.test(l)),
);
console.log("sample:", labels.slice(0, 12).join(", "));

// Monaco provider path: trigger the suggest widget at the same position.
await win.evaluate((p) => {
  const ed = window.__monaco.editor
    .getEditors()
    .find((e) => e.getModel()?.uri.path.endsWith(".ts"));
  ed.setPosition({ lineNumber: p.line, column: p.col });
  ed.focus();
  ed.trigger("e2e", "editor.action.triggerSuggest", {});
}, pos);
await win.waitForTimeout(1500);
const rows = await win.evaluate(
  () => document.querySelectorAll(".suggest-widget .monaco-list-row").length,
);
console.log("suggest-widget rows:", rows);

await win.screenshot({ path: "/tmp/sz-surql-template.png" });
await app.close();
console.log("done");
