// Verifies explorer visual polish: indent guides per nesting depth, and the empty-folder
// muted-italic placeholder. (Loading skeleton is wired for children===null but loads too
// fast on local fs to assert reliably.)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const proj = "/tmp/sz-explorer-visual";
rmSync(proj, { recursive: true, force: true });
mkdirSync(join(proj, "schema", "tables"), { recursive: true });
mkdirSync(join(proj, "empty"), { recursive: true });
writeFileSync(join(proj, "schema", "tables", "user.ts"), "x");
writeFileSync(join(proj, "config.ts"), "x");

const app = await electron.launch({
  executablePath: require("electron"),
  args: [appDir, "--no-sandbox", "--disable-gpu"],
  cwd: appDir,
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("[pageerror]", e.message));
await win.waitForSelector(".editor-empty-title");
await win.evaluate((d) => window.__studio.getState().openProject(d), proj);
await win.waitForSelector(".tree-row");

const toggle = (p) =>
  win.evaluate((x) => window.__studio.getState().toggleDir(x), p);
await toggle(`${proj}/schema`);
await win.waitForTimeout(150);
await toggle(`${proj}/schema/tables`);
await toggle(`${proj}/empty`);
await win.waitForTimeout(300);

const guides = await win.evaluate(
  () => document.querySelectorAll(".tree-guide").length,
);
const empty = await win.evaluate(() => {
  const el = document.querySelector(".tree-empty");
  return el ? el.textContent?.trim() : null;
});
console.log("indent guide lines (expect > 0):", guides);
console.log("empty-folder placeholder text:", JSON.stringify(empty));
console.log("ok:", guides > 0 && empty === "empty");

await app.close();
rmSync(proj, { recursive: true, force: true });
console.log("done");
