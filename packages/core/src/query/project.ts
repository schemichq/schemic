import type { FieldRefBase } from "./ref";

/**
 * Infer the result element type of a `.return(row => P)` projection: replace every field ref in the
 * returned shape `P` with the decoded app value it carries, recursing into nested objects and arrays.
 * This is the type-level half of result typing (surqlize's `InheritableIntoType` analog); the runtime
 * half is the projection codec (./codec). Generic over ANY driver ref — it only reads the
 * `FieldRefBase` carrier, never a concrete driver type.
 *
 * ```ts
 * type R = Project<{ name: Ref<string>; meta: { at: Ref<Date> } }>;
 * //   ^? { name: string; meta: { at: Date } }
 * ```
 *
 * Refs are matched BEFORE the generic object branch, so a ref (which is itself an object carrying
 * operator methods) is unwrapped to its value rather than mapped field-by-field.
 */
export type Project<P> = P extends FieldRefBase<infer T>
  ? T
  : P extends readonly (infer E)[]
    ? Project<E>[]
    : P extends object
      ? { [K in keyof P]: Project<P[K]> }
      : P;
