import { z } from "zod";
import type { CallableFunctions } from "../driver/driver";

/**
 * Invoke a defined DB function via the driver's `callable` capability and **decode its result through the
 * function's `.returns(R)` schema** — the neutral half of the query layer's (B) `.call()`. A driver's
 * `defineFunction(args).returns(R).call(db, appArgs)` composes this: it encodes `appArgs` to wire (via
 * the arg schemas) and passes `R` here. Decode-by-default is the differentiator — results come back as
 * real `App` types (`Date`, `RecordId`, …), not wire. A `.raw()` path skips this and returns
 * `callable.invoke(...)` directly.
 */
export async function callFunction<S extends z.ZodType>(
  callable: CallableFunctions,
  conn: unknown,
  name: string,
  args: Record<string, unknown>,
  returns: S,
): Promise<z.output<S>> {
  const raw = await callable.invoke(conn, name, args);
  return z.decode(returns, raw as never);
}
