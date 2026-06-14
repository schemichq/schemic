// Verifies the integrated terminal (dock pane, variant B): the main-process command runner
// streams output over IPC, and the xterm pane mounts when the output pane switches to Terminal.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const cwd = "/tmp/sz-term";
mkdirSync(cwd, { recursive: true });

const app = await electron.launch({
  executablePath: require("electron"),
  args: [appDir, "--no-sandbox", "--disable-gpu"],
  cwd: appDir,
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("[pageerror]", e.message));
await win.waitForSelector(".editor-empty-title");

// Open a project so workspaceRoot is set + the cwd is an allowed root.
await win.evaluate((dir) => window.__studio.getState().openProject(dir), cwd);

// Backend: run a command through the adapter and collect streamed output + exit.
const res = await win.evaluate(
  (cwd) =>
    new Promise((resolve) => {
      const id = "e2e";
      let out = "";
      const off = window.studio.terminal.onEvent((e) => {
        if (e.id !== id) return;
        if (e.type === "data") out += e.chunk;
        else {
          off();
          resolve({ out, code: e.code });
        }
      });
      window.studio.terminal.run(id, "echo reverie-terminal-ok", cwd);
    }),
  cwd,
);
console.log(
  "backend output has echo:",
  res.out.includes("reverie-terminal-ok"),
);
console.log("backend exit code:", res.code);

// UI: switch the output pane to Terminal and confirm the xterm mounts.
await win.evaluate(() => {
  const title = document.querySelector(".output-panel .pane-title");
  title?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await win.waitForTimeout(150);
await win.evaluate(() => {
  const items = [...document.querySelectorAll(".output-panel .pane-menu-item")];
  const term = items.find((b) => b.textContent?.includes("Terminal"));
  term?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await win.waitForSelector(".output-panel .terminal-host .xterm", {
  timeout: 5000,
});
await win.waitForTimeout(500);
const promptShown = await win.evaluate(() => {
  const rows = document.querySelector(
    ".output-panel .terminal-host .xterm-rows",
  );
  return (rows?.textContent ?? "").includes("sz-term");
});
console.log("xterm mounted:", true);
console.log("prompt shows project name:", promptShown);

await win.screenshot({ path: "/tmp/sz-terminal.png" });
await app.close();
console.log("done");
