// Shared command-action runner: execute an action to completion, format any error the same way across
// EVERY command (built-ins, driver `sc <kind> <verb>`, and the inspect ls/info), and force `process.exit`
// once it settles so a lingering SDK connection handle can't keep the process alive. SCHEMIC_DEBUG=1
// (or --stack) prints the full stack + the `.cause` chain; otherwise a one-line hint. Watch commands
// return a never-settling promise, so they keep running until SIGINT.
import { fail, style } from "@schemic/core";

const errMsg = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** Run `action`, then exit (0 on success / the set exitCode; 1 on a thrown error, printed cleanly). */
export function runAction(action: () => Promise<void>): void {
  action().then(
    () => process.exit(process.exitCode ?? 0),
    (err: unknown) => {
      console.error(`\n${fail(errMsg(err))}`);
      if (process.env.SCHEMIC_DEBUG || process.argv.includes("--stack")) {
        for (let e: unknown = err, depth = 0; e && depth < 8; depth++) {
          console.error(
            style.dim(e instanceof Error ? (e.stack ?? String(e)) : String(e)),
          );
          e = e instanceof Error ? e.cause : undefined;
          if (e) console.error(style.dim("caused by:"));
        }
      } else {
        console.error(
          style.dim(
            "(re-run with SCHEMIC_DEBUG=1 or --stack for the stack trace)",
          ),
        );
      }
      process.exit(1);
    },
  );
}
