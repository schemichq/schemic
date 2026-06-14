// Verifies WAI-ARIA keyboard navigation in the File Explorer: roving focus (Up/Down),
// expand (Right), open (Enter), and the :focus-visible ring.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const proj = resolve(appDir, "../example-credilisto/database/schema");

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

const rowText = () =>
  win.evaluate(() => document.activeElement?.textContent?.trim() ?? "(none)");

// Focus the seeded first row.
await win.evaluate(() =>
  document.querySelector('.tree-row[tabindex="0"]')?.focus(),
);
console.log("first focused row:", await rowText());
console.log(
  "focus-visible ring:",
  await win.evaluate(() => !!document.activeElement?.matches(":focus-visible")),
);

await win.keyboard.press("ArrowDown");
console.log("after ArrowDown:", await rowText());
await win.keyboard.press("ArrowUp");
console.log("after ArrowUp (back to first):", await rowText());

// Expand the first folder with Right (aria-expanded false -> true), then descend.
const wasExpanded = await win.evaluate(() =>
  document.activeElement?.getAttribute("aria-expanded"),
);
await win.keyboard.press("ArrowRight");
await win.waitForTimeout(300);
const nowExpanded = await win.evaluate(() =>
  document
    .querySelector('.tree-row[aria-level="1"]')
    ?.getAttribute("aria-expanded"),
);
console.log(`folder expand via Right: ${wasExpanded} -> ${nowExpanded}`);
await win.keyboard.press("ArrowRight"); // descend into first child
console.log("after descend:", await rowText());

// Navigate to a file and open it with Enter.
let opened = false;
for (let i = 0; i < 12; i++) {
  const isFile = await win.evaluate(
    () => document.activeElement?.getAttribute("aria-expanded") === null,
  );
  const name = await rowText();
  if (isFile && name.endsWith(".ts")) {
    await win.keyboard.press("Enter");
    await win.waitForTimeout(400);
    opened = await win.evaluate(
      () => !!document.querySelector(".file-tab.active"),
    );
    console.log("opened file via Enter:", name, "->", opened);
    break;
  }
  await win.keyboard.press("ArrowDown");
}
console.log("file open worked:", opened);

await win.screenshot({ path: "/tmp/sz-explorer-kbd.png" });
await app.close();
console.log("done");
