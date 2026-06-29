#!/usr/bin/env node
// `schemic` / `sc` — a thin alias that runs the real CLI from @schemic/cli. Resolves the CLI's
// package.json (an exported subpath), reads its `bin`, and imports that file directly (a file URL
// bypasses the package `exports` map), so it never depends on @schemic/cli exposing lib/ as a subpath.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const pkgJsonPath = require.resolve("@schemic/cli/package.json");
const { bin } = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
const entry = typeof bin === "string" ? bin : bin.schemic;
await import(pathToFileURL(join(dirname(pkgJsonPath), entry)).href);
