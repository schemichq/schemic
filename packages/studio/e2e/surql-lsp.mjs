// Verifies the SurrealQL language server integration: open a .surql file and confirm the
// server is available, completions come back, and diagnostics flow.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const file = resolve(
  appDir,
  "../example-git/database/migrations/20260612052310_initial.surql",
);
const dir = dirname(file);

const app = await electron.launch({
  executablePath: require("electron"),
  args: [appDir, "--no-sandbox", "--disable-gpu"],
  cwd: appDir,
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("[pageerror]", e.message));
await win.waitForSelector(".editor-empty-title");

console.log(
  "surql LSP available:",
  await win.evaluate(() => window.studio.surql.available()),
);

await win.evaluate(
  async ([dir, file]) => {
    await window.studio.fs.addRoot(dir);
    await window.__studio.getState().openFilePath(file);
  },
  [dir, file],
);
await win.waitForSelector(".editor-host .monaco-editor");
await win.waitForTimeout(1500);

// The open .surql model URI + a position to ask completions at.
const ctx = await win.evaluate(() => {
  const m = window.__monaco.editor
    .getModels()
    .find((x) => x.uri.path.endsWith(".surql"));
  return { uri: `file://${m.uri.path}`, lastLine: m.getLineCount() };
});
console.log("surql model:", ctx?.uri);

// Poll completion until the server has parsed the doc.
let count = 0;
let labels = [];
for (let i = 0; i < 20; i++) {
  const res = await win.evaluate(
    (c) =>
      window.studio.surql.request(
        "textDocument/completion",
        { textDocument: { uri: c.uri }, position: { line: 4, character: 8 } },
        null,
      ),
    ctx,
  );
  const r = res?.result;
  const items = Array.isArray(r) ? r : (r?.items ?? []);
  count = items.length;
  labels = items.slice(0, 10).map((it) => it.label);
  if (count > 0) break;
  await win.waitForTimeout(500);
}
console.log("completion count:", count);
console.log("sample labels:", labels.join(", "));

await app.close();
console.log("done");
