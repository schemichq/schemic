// Fast local validator: run the same Twoslash over every `ts twoslash` block in the
// docs so we catch sample type errors in seconds instead of a full vite build.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

// `twoslash` is a transitive dep (it lives in bun's central store), so resolve it by
// walking up to the nearest `node_modules/.bun` and locating the package there.
function findTwoslash() {
  let dir = process.cwd();
  while (dir !== "/") {
    const store = join(dir, "node_modules", ".bun");
    if (existsSync(store)) {
      const pkg = readdirSync(store).find((d) => d.startsWith("twoslash@"));
      if (pkg)
        return join(
          store,
          pkg,
          "node_modules",
          "twoslash",
          "dist",
          "index.mjs",
        );
    }
    dir = dirname(dir);
  }
  throw new Error("could not locate the twoslash package");
}
const { createTwoslasher } = await import(findTwoslash());

const ROOT = new URL("../content/docs", import.meta.url).pathname;

const twoslasher = createTwoslasher({
  compilerOptions: {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    skipLibCheck: true,
  },
});

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".mdx")) out.push(p);
  }
  return out;
}

function blocks(src) {
  const re = /```ts twoslash\n([\s\S]*?)```/g;
  const found = [];
  for (const m of src.matchAll(re)) {
    const before = src.slice(0, m.index).split("\n").length;
    found.push({ line: before, code: m[1] });
  }
  return found;
}

let failures = 0;
let total = 0;
for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  for (const b of blocks(src)) {
    total++;
    try {
      twoslasher(b.code, "ts");
    } catch (err) {
      failures++;
      const rel = file.replace(`${ROOT}/`, "");
      console.error(
        `\n✗ ${rel}:${b.line}\n${String(err.message || err).slice(0, 800)}`,
      );
    }
  }
}

console.log(`\n${total - failures}/${total} twoslash blocks OK`);
process.exit(failures ? 1 : 0);
