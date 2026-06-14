// Verifies explorer UI flows: right-click context menu, header New File (inline input),
// and F2 inline rename.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const proj = "/tmp/sz-explorer-ui";
rmSync(proj, { recursive: true, force: true });
mkdirSync(proj, { recursive: true });
writeFileSync(join(proj, "seed.ts"), "export const x = 1;\n");

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

const names = () =>
  win.evaluate(() => window.__studio.getState().tree?.map((n) => n.name) ?? []);

// 1) Right-click context menu.
await win.evaluate(() => {
  const row = document.querySelector(".tree-row");
  row?.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      clientX: 120,
      clientY: 160,
    }),
  );
});
await win.waitForSelector(".ctx-menu");
const items = await win.evaluate(() =>
  [...document.querySelectorAll(".ctx-item")].map((b) => b.textContent),
);
console.log("ctx-menu items:", items.join(" | "));
// dismiss
await win.keyboard.press("Escape");

// 2) Header New File -> inline input -> type + Enter.
await win.evaluate(() =>
  document
    .querySelector('.pane-action[title="New File"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
);
await win.waitForSelector(".tree-input");
await win.locator(".tree-input").fill("made.ts");
await win.locator(".tree-input").press("Enter");
await win.waitForTimeout(400);
console.log("after New File:", (await names()).join(","));
console.log(
  "made.ts opened:",
  await win.evaluate(
    () => window.__studio.getState().activePath?.endsWith("made.ts") ?? false,
  ),
);

// 3) F2 rename on the focused row (made.ts is active/focused after creation).
await win.evaluate(() => {
  const made = [...document.querySelectorAll(".tree-row")].find((r) =>
    r.textContent?.includes("made.ts"),
  );
  made?.focus();
});
await win.evaluate(() => {
  document
    .querySelector(".tree-scroll")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
});
await win.waitForSelector(".tree-input");
await win.locator(".tree-input").fill("renamed.ts");
await win.locator(".tree-input").press("Enter");
await win.waitForTimeout(400);
console.log("after F2 rename:", (await names()).join(","));

await win.screenshot({ path: "/tmp/sz-explorer-ui.png" });
await app.close();
rmSync(proj, { recursive: true, force: true });
console.log("done");
