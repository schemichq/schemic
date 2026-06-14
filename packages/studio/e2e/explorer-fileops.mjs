// Verifies the explorer fs-mutation foundation: create / rename / duplicate / mkdir / delete
// through the store actions, with the tree refreshing after each.
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const proj = "/tmp/sz-fileops";
rmSync(proj, { recursive: true, force: true });
mkdirSync(proj, { recursive: true });

const app = await electron.launch({
  executablePath: require("electron"),
  args: [appDir, "--no-sandbox", "--disable-gpu"],
  cwd: appDir,
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("[pageerror]", e.message));
await win.waitForSelector(".editor-empty-title");
await win.evaluate((d) => window.__studio.getState().openProject(d), proj);
await win.waitForSelector(".explorer");

const names = () =>
  win.evaluate(() => window.__studio.getState().tree?.map((n) => n.name) ?? []);
await win.evaluate(
  (d) => window.__studio.getState().newFile(d, "foo.ts"),
  proj,
);
console.log("after newFile:", (await names()).join(","));
console.log(
  "foo.ts opened as active doc:",
  await win.evaluate(
    () => window.__studio.getState().activePath?.endsWith("foo.ts") ?? false,
  ),
);

await win.evaluate(
  (d) => window.__studio.getState().renameNode(`${d}/foo.ts`, "bar.ts"),
  proj,
);
console.log("after rename:", (await names()).join(","));
console.log(
  "open doc re-keyed to bar.ts:",
  await win.evaluate(() =>
    window.__studio.getState().docs.some((x) => x.name === "bar.ts"),
  ),
);

await win.evaluate(
  (d) => window.__studio.getState().duplicateNode(`${d}/bar.ts`),
  proj,
);
console.log("after duplicate:", (await names()).join(","));

await win.evaluate((d) => window.__studio.getState().newFolder(d, "sub"), proj);
console.log("after newFolder:", (await names()).join(","));

const delResult = await win.evaluate(
  (d) =>
    window.__studio
      .getState()
      .deleteNode(`${d}/bar.ts`)
      .then(() => "ok")
      .catch((e) => `err: ${e.message}`),
  proj,
);
console.log("delete bar.ts:", delResult, "| tree:", (await names()).join(","));

await app.close();
rmSync(proj, { recursive: true, force: true });
console.log("done");
