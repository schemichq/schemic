import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Driver } from "@schemic/core";

export interface InitResult {
  created: string[];
  skipped: string[];
}

/**
 * The empty migration snapshot a fresh project starts from. Dialect-NEUTRAL (the KindSnapshot shape is
 * core's), tagged with the driver so the snapshot reader knows who owns its `schema` payload.
 */
function initialSnapshot(driver: string): string {
  return `${JSON.stringify(
    {
      version: 3,
      driver,
      schema: { kinds: {} },
      files: {},
    },
    null,
    2,
  )}\n`;
}

/**
 * Scaffold a fresh project for `driver`. The dialect files (config, sample schema, seed, env) come
 * from the driver's {@link Driver.initScaffold}; the CLI adds the neutral migration snapshot. Never
 * overwrites existing files. The CLI itself stays dialect-free — it only knows the file map.
 */
export function init(cwd: string, driver: Driver<unknown>): InitResult {
  const scaffold = driver.initScaffold?.();
  if (!scaffold)
    throw new Error(
      `the "${driver.name}" driver does not support \`schemic init\` scaffolding.`,
    );
  const files: Record<string, string> = {
    ...scaffold,
    "database/migrations/meta/_snapshot.json": initialSnapshot(driver.name),
  };

  const created: string[] = [];
  const skipped: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolve(cwd, rel);
    if (existsSync(abs)) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    created.push(rel);
  }
  return { created, skipped };
}
