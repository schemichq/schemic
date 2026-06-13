// Verifies the Code Editor view: file tab strip, contextual output Pane Header,
// the type-switcher dropdown, and the Run loop into the Result body.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");

const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir, "--no-sandbox", "--disable-gpu"],
  cwd: appDir,
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("[pageerror]", e.message));

await win.waitForSelector(".file-tab.active");
const tabName = await win.evaluate(
  () =>
    document.querySelector(".file-tab.active .file-tab-name")?.textContent ??
    "",
);
console.log("active tab:", tabName);

await win.waitForSelector(".pane-title-text");
const paneTitle = await win.evaluate(
  () => document.querySelector(".pane-title-text")?.textContent ?? "",
);
console.log("output pane type:", paneTitle);

// Run loop into the Result body.
await win.waitForSelector(".result-table tbody tr");
const rows = await win.evaluate(
  () => document.querySelectorAll(".result-table tbody tr").length,
);
console.log("result rows:", rows);

// Open the type-switcher dropdown and switch to Problems.
await win.click(".pane-title");
await win.waitForSelector(".pane-menu");
const menuItems = await win.evaluate(() =>
  [...document.querySelectorAll(".pane-menu-item")].map((b) => b.textContent),
);
console.log("menu items:", menuItems.join(" | "));
await win.evaluate(() => {
  const items = [...document.querySelectorAll(".pane-menu-item")];
  items.find((b) => b.textContent?.includes("Problems"))?.click();
});
await win.waitForTimeout(300);
const switched = await win.evaluate(
  () => document.querySelector(".pane-title-text")?.textContent ?? "",
);
console.log("after switch, pane type:", switched);

await win.screenshot({ path: "/tmp/sz-editor-view.png" });
await app.close();
console.log("done");
