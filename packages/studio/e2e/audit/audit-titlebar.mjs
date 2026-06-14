// Design-vs-build audit (PoC) for the titlebar. Launches the Electron app, extracts a
// normalized StyleRecord per anchored element (computed styles + geometry + text), and diffs
// it token-aware against the design manifest exported from Pencil. Reports matches +
// divergences with the actual built value — the manual File-Explorer/titlebar audit, automated.
//
// Run: node e2e/audit/audit-titlebar.mjs   (build first: electron-vite build)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { toToken } from "./tokens.mjs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "..");
const manifest = JSON.parse(
  readFileSync(join(here, "manifest.titlebar.json"), "utf8"),
);

const COLOR_PROPS = new Set([
  "bg",
  "fg",
  "borderTopColor",
  "borderBottomColor",
]);
const EXACT_PROPS = new Set([
  "borderTopWidth",
  "borderBottomWidth",
  "fontWeight",
]);
const PX_TOLERANCE = 1; // sub-pixel / rounding slack

const app = await electron.launch({
  executablePath: require("electron"),
  args: [appDir, "--no-sandbox", "--disable-gpu"],
  cwd: appDir,
});
const win = await app.firstWindow();
win.on("pageerror", (e) => console.log("[pageerror]", e.message));
await win.waitForSelector(".tb-c");

// Build-side extractor: normalize computed styles + geometry + text for a selector.
async function extract(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const num = (v) => Number.parseFloat(v) || 0;
    return {
      bg: cs.backgroundColor,
      fg: cs.color,
      borderTopColor: cs.borderTopColor,
      borderBottomColor: cs.borderBottomColor,
      borderTopWidth: num(cs.borderTopWidth),
      borderBottomWidth: num(cs.borderBottomWidth),
      fontSize: num(cs.fontSize),
      fontWeight: Number.parseInt(cs.fontWeight, 10) || 400,
      fontFamily: cs.fontFamily,
      paddingTop: num(cs.paddingTop),
      paddingLeft: num(cs.paddingLeft),
      gap: num(cs.columnGap === "normal" ? cs.gap : cs.columnGap),
      // Resolve a percentage radius against the box (50% on a 26px circle == 13px).
      radius: cs.borderTopLeftRadius.includes("%")
        ? (num(cs.borderTopLeftRadius) / 100) * Math.min(r.width, r.height)
        : num(cs.borderTopLeftRadius),
      width: Math.round(r.width),
      height: Math.round(r.height),
      text: el.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  }, selector);
}

const divergences = [];
let matches = 0;
let missing = 0;
let ignored = 0;
let anchored = 0;
const unmapped = [];

for (const rec of manifest.records) {
  // Coverage model: every styled node must be anchored (selector+props) or explicitly ignored.
  // A node with neither is a gap — surfaced rather than silently uncovered.
  if (rec.ignore) {
    ignored++;
    continue;
  }
  if (!rec.selector || !rec.props) {
    unmapped.push(rec.anchor);
    continue;
  }
  anchored++;
  const built = await extract(rec.selector);
  if (!built) {
    missing++;
    console.log(
      `MISSING  ${rec.anchor}  (selector not found: ${rec.selector})`,
    );
    continue;
  }
  for (const [prop, expected] of Object.entries(rec.props)) {
    let actual;
    let ok;
    if (COLOR_PROPS.has(prop)) {
      actual = toToken(built[prop]);
      ok = actual === expected;
    } else if (prop === "fontFamily") {
      actual = built.fontFamily;
      ok = actual.toLowerCase().includes(String(expected).toLowerCase());
    } else if (prop === "text") {
      actual = built.text;
      ok = actual === expected;
    } else {
      actual = built[prop];
      // Border width + font weight compare exact (0-vs-1px border, or 600-vs-700, matter);
      // other px props get sub-pixel slack.
      const tol = EXACT_PROPS.has(prop) ? 0 : PX_TOLERANCE;
      ok = Math.abs(Number(actual) - Number(expected)) <= tol;
    }
    if (ok) matches++;
    else divergences.push({ anchor: rec.anchor, prop, expected, actual });
  }
}

console.log("\n=== Titlebar design-vs-build audit ===");
console.log(
  `nodes: ${manifest.records.length}  |  anchored: ${anchored}  |  ignored: ${ignored}  |  unmapped: ${unmapped.length}`,
);
console.log(
  `prop matches: ${matches}  |  divergences: ${divergences.length}  |  missing anchors: ${missing}`,
);
if (unmapped.length) {
  console.log(
    "\nUNMAPPED (styled node with no selector + no ignore — coverage gap):",
  );
  for (const a of unmapped) console.log(`  ${a}`);
}
if (divergences.length) {
  console.log("\nDIVERGENCES:");
  for (const d of divergences)
    console.log(
      `  [${d.anchor}] ${d.prop}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`,
    );
}
if (!divergences.length && !missing && !unmapped.length) {
  console.log("\nAll anchored props match the design, full coverage. ✔");
}

await app.close();
process.exit(divergences.length || missing || unmapped.length ? 1 : 0);
