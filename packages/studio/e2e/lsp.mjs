// Verifies the real tsserver language service: open credilisto user.ts (a real project
// with node_modules), then ask tsserver for completions after `sz.` and confirm it
// returns the real surreal-zod members (string/number/datetime/...).
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const file = resolve(
  appDir,
  "../example-credilisto/database/schema/tables/user.ts",
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

await win.evaluate(
  async ([dir, file]) => {
    await window.studio.fs.addRoot(dir);
    await window.__studio.getState().openFilePath(file);
  },
  [dir, file],
);
await win.waitForSelector(".editor-host .monaco-editor");
await win.waitForTimeout(500);

// Resolve the open TS model's URI path + the position right after the first `sz.`.
const pos = await win.evaluate(() => {
  const m = window.__monaco.editor
    .getModels()
    .find((x) => x.getLanguageId() === "typescript");
  if (!m) return null;
  const text = m.getValue();
  const idx = text.indexOf("sz.");
  const upto = text.slice(0, idx + 3);
  const lines = upto.split("\n");
  return {
    file: m.uri.path,
    line: lines.length,
    offset: lines[lines.length - 1].length + 1,
  };
});
console.log("model file:", pos?.file, "| sz. at", pos?.line, pos?.offset);

// Poll tsserver until it's loaded the project and returns completions.
let names = [];
for (let i = 0; i < 24; i++) {
  const res = await win.evaluate(
    (p) => window.studio.lsp.request("completionInfo", p),
    pos,
  );
  names = res?.body?.entries?.map((e) => e.name) ?? [];
  if (names.length > 0) break;
  await win.waitForTimeout(500);
}
console.log("sz. completion count:", names.length);
console.log("has string:", names.includes("string"));
console.log("has datetime:", names.includes("datetime"));
console.log("has number:", names.includes("number"));
console.log("sample:", names.slice(0, 12).join(", "));

// Full Monaco provider path: place the cursor after `sz.` and trigger the suggest widget.
await win.evaluate((p) => {
  const ed = window.__monaco.editor.getEditors()[0];
  ed.setPosition({ lineNumber: p.line, column: p.offset });
  ed.focus();
  ed.trigger("e2e", "editor.action.triggerSuggest", {});
}, pos);
await win.waitForTimeout(1500);
const widget = await win.evaluate(() => ({
  rows: document.querySelectorAll(".suggest-widget .monaco-list-row").length,
}));
console.log("suggest-widget rows:", widget.rows);
await win.screenshot({ path: "/tmp/sz-lsp.png" });

// Diagnostics: the false "Cannot find module" must be gone (tsserver resolves imports).
const markers = await win.evaluate((f) => {
  const m = window.__monaco.editor.getModels().find((x) => x.uri.path === f);
  return window.__monaco.editor
    .getModelMarkers({ resource: m.uri })
    .map((k) => k.message);
}, pos.file);
console.log("markers:", markers.length);
console.log(
  "no 'Cannot find module':",
  !markers.some((m) => m.includes("Cannot find module")),
);

await app.close();
console.log("done");
