// The KIND REGISTRY subsystem (core-v2) — the generic, open replacement for the fixed object-kind
// slots. See ./registry.ts (the primitive + per-driver registry) and ./plan.ts (the kind-blind
// migration spine + cross-kind dependency ordering). Additive: the fixed-slot `Driver`/`PortableDb`
// path is untouched while kinds migrate onto this one (docs/kind-registry.md §8).

export {
  buildKindDiff,
  emitKinds,
  introspectKinds,
  type KindPlan,
  type KindSnapshot,
  lowerSchema,
  type OrderNode,
  orderObjects,
  planKinds,
  snapshotKinds,
  snapshotObjects,
} from "./plan";
export {
  type Definable,
  type KindDisplay,
  type KindEngine,
  KindRegistry,
  type KindSpec,
  type PortableObject,
  type Ref,
  type ResolvedDisplay,
} from "./registry";
