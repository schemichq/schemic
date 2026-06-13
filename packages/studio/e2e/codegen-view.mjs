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

// Linked highlighting: simulate the editor cursor landing on the `email` field.
await win.evaluate(() => window.__studio.getState().setLinkedName("email"));
await win.waitForTimeout(300);
const linked = await win.evaluate(
  () => !!document.querySelector(".output-panel .linked-line"),
);
console.log("linked-highlight on email:", linked);

await win.screenshot({ path: "/tmp/sz-codegen.png" });
await app.close();
console.log("done");
