// Verifies the FileSystem adapter round-trip: open a real file into the editor (read),
// edit + save it (write), confirm the change hit disk. Uses a temp dir (no native dialog).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const dir = mkdtempSync(join(tmpdir(), "sz-fs-"));
const file = join(dir, "demo.surql");
writeFileSync(file, "SELECT * FROM original;\n");

const app = await electron.launch({
  executablePath: require("electron"),
  args: [appDir, "--no-sandbox", "--disable-gpu"],
  cwd: appDir,
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("[pageerror]", e.message));
await win.waitForSelector(".app");

// Register the dir as an allowed root, then open the file (READ path).
await win.evaluate((d) => window.__studio.getState().openProject(d), dir);
await win.evaluate((f) => window.__studio.getState().openFilePath(f), file);
await win.waitForTimeout(300);
const read = await win.evaluate(() => ({
  tab: document.querySelector(".file-tab.active .file-tab-name")?.textContent,
  buffer: (() => {
    const s = window.__studio.getState();
    return s.docs.find((d) => d.path === s.activePath)?.content;
  })(),
}));
console.log("READ  tab:", read.tab, "| buffer:", JSON.stringify(read.buffer));

// Edit + save (WRITE path).
await win.evaluate(() => {
  const s = window.__studio.getState();
  s.setContent(s.activePath, "SELECT * FROM edited;\n");
});
await win.evaluate(() => window.__studio.getState().saveActive());
await win.waitForTimeout(300);
console.log("SAVE  on disk:", JSON.stringify(readFileSync(file, "utf8")));

// Path-scoping guard: writing outside any root must be rejected.
const blocked = await win.evaluate(async () => {
  try {
    await window.studio.fs.write("/etc/sz-should-not-write", "x");
    return false;
  } catch {
    return true;
  }
});
console.log("GUARD outside-root write blocked:", blocked);

await app.close();
console.log("done");
