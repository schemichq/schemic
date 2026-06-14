// Pixel visual-regression for the titlebar — the second signal that complements the
// structural audit. It screenshots the rendered titlebar and diffs it against a committed
// baseline, so ANY visual change (a border vanishing in a refactor, a color shift) is caught
// without needing the prop anchored. Structural audit = design conformance (needs anchors);
// this = drift guard (anchor-free, baseline-relative).
//
// Run:           node e2e/audit/visual-titlebar.mjs
// Re-baseline:   UPDATE_BASELINE=1 node e2e/audit/visual-titlebar.mjs  (after an intended change)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { _electron as electron } from "playwright";
import { PNG } from "pngjs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "..");
const baselineDir = join(here, "baselines");
const baselinePath = join(baselineDir, "titlebar.png");
const diffPath = "/tmp/sz-titlebar-visual-diff.png";
const RATIO_THRESHOLD = 0.002; // 0.2% of pixels may differ (anti-aliasing slack)

const app = await electron.launch({
  executablePath: require("electron"),
  args: [appDir, "--no-sandbox", "--disable-gpu"],
  cwd: appDir,
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("[pageerror]", e.message));
await win.waitForSelector(".tb-c");
await win.waitForTimeout(400); // fonts/icons settle

const shot = await win.locator(".tb-c").screenshot();
await app.close();

if (process.env.UPDATE_BASELINE || !existsSync(baselinePath)) {
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(baselinePath, shot);
  console.log(
    existsSync(baselinePath) && process.env.UPDATE_BASELINE
      ? "baseline UPDATED (titlebar.png)"
      : "baseline CREATED (titlebar.png) — commit it; future runs diff against it",
  );
  process.exit(0);
}

const baseline = PNG.sync.read(readFileSync(baselinePath));
const current = PNG.sync.read(shot);

if (baseline.width !== current.width || baseline.height !== current.height) {
  console.log(
    `DIMENSION CHANGE: baseline ${baseline.width}x${baseline.height} vs current ${current.width}x${current.height} — titlebar geometry changed`,
  );
  process.exit(1);
}

const { width, height } = baseline;
const diff = new PNG({ width, height });
const diffPixels = pixelmatch(
  baseline.data,
  current.data,
  diff.data,
  width,
  height,
  { threshold: 0.1 },
);
const ratio = diffPixels / (width * height);

console.log("\n=== Titlebar pixel visual-regression ===");
console.log(
  `size ${width}x${height}  |  diff pixels: ${diffPixels}  |  ratio: ${(ratio * 100).toFixed(3)}%  |  threshold: ${(RATIO_THRESHOLD * 100).toFixed(1)}%`,
);
if (ratio > RATIO_THRESHOLD) {
  writeFileSync(diffPath, PNG.sync.write(diff));
  console.log(`REGRESSION — diff image: ${diffPath}`);
  console.log("(intended change? re-run with UPDATE_BASELINE=1)");
  process.exit(1);
}
console.log("No visual regression vs baseline. ✔");
process.exit(0);
