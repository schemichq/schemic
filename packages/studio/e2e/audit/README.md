# Design-vs-build audit (PoC)

Automates the manual "does the build match Pencil?" audit: extract a normalized
`StyleRecord` from the **running app** and diff it, token-aware, against a **design
manifest** exported from Pencil. Same idea as the hand audits of the File Explorer and
titlebar — formalized and repeatable.

## How it works

1. **Design manifest** (`manifest.<area>.json`) — normalized records exported from the
   Pencil "<Area> Kit" via the Pencil MCP (`batch_get` with `resolveVariables`/
   `resolveInstances`). Colors are stored as **token names** (`accent-soft`), sizes in px.
   Each record pairs a Pencil node to a **CSS selector** (the anchor) and lists only the
   props that matter for that element.
2. **Build extractor** (`audit-<area>.mjs`) — launches the Electron app with Playwright and
   reads `getComputedStyle` + geometry + text for each anchor selector, normalizing units.
3. **Token-aware diff** (`tokens.mjs`) — parses `theme.css` `:root` so computed `rgb()` maps
   back to a token **name**; colors compare by name (survives theme changes, readable diffs).
   Numeric props get ±1px slack; **border width + font weight compare exact** (0-vs-1px border
   or 600-vs-700 weight are meaningful). Percentage radii are resolved against the box
   (`50%` on a 26px circle == `13px`).

**Coverage model:** the manifest enumerates the *full* composition-level node set of the
component. Every styled node is either **anchored** (`selector` + `props`) or explicitly
**`ignore`d** (with a reason — layout containers, spacers, component instances). A node that is
neither is reported as **UNMAPPED** — so coverage is visible, not silent. (This is what closes
the "forgot to anchor the frame's bottom border" class of miss; see Proof.)

**Two signals, run together:**

```
npx electron-vite build
node e2e/audit/audit-titlebar.mjs     # structural/token diff — design conformance (needs anchors)
node e2e/audit/visual-titlebar.mjs    # pixel diff vs committed baseline — drift guard (anchor-free)
```

Both exit non-zero on failure. Re-baseline the pixel test after an intended change:
`UPDATE_BASELINE=1 node e2e/audit/visual-titlebar.mjs`.

- **Structural audit** — semantic, deterministic, token-aware; catches divergence from the
  *design* but only for anchored props.
- **Pixel visual-regression** (`visual-titlebar.mjs`, `baselines/titlebar.png`) — screenshots
  the titlebar and diffs against a committed baseline via `pixelmatch`. Catches *any* visual
  change (a border vanishing, a color shift) with no anchor needed, but relative to the last
  approved baseline rather than the design. The two are complementary.

## Extending

- **New props:** add the key to the extractor's record + (for colors) `COLOR_PROPS`, then
  list it in a manifest record's `props`.
- **New component:** add `manifest.<area>.json` (from Pencil) + an `audit-<area>.mjs` (or
  generalize the runner to take a manifest path). Drive any interaction state first
  (hover/open) before extracting, and anchor the matching Pencil **state node**.
- **Anchor map** is the one hand-authored part: Pencil nodeId ↔ CSS selector. It's the
  source of truth for "this element *is* this design node."

## Known limits / next steps

- The **manifest is a committed snapshot** (Pencil MCP isn't available in plain CI). Re-export
  when the design changes. This decouples the audit from a live Pencil so it can gate CI.
- **Coverage = anchor completeness for the structural audit.** The UNMAPPED report makes gaps
  visible *within* the enumerated node set, but a brand-new Pencil node only enters the set when
  the manifest is re-exported. The pixel signal backstops this (it needs no anchors).
- **Geometry from Pencil**: variable-bound `width`/`height` resolve to 0 in Pencil — compare
  only numeric dims.
- Per-prop **adapters** may be needed (e.g. a "glyph" frame's `fill` → the inner SVG `color`).
- Generalize the two runners to take a `--manifest`/area arg so new components (explorer, …)
  reuse them instead of copy-paste.

## Proof

On first run this PoC reproduced a real divergence the manual audit had found —
`[Connection Switcher] borderTopWidth: expected 0, got 1` (design's connection switcher has no
border; the shared `.ctx-switcher` gave it one). Fixing the build (`.ctx-switcher--plain`)
turned the audit green.

Then a divergence the audit *missed* showed the flip side: the Title Bar C **frame's** outer
bottom border (`#2a2438`, on Pencil `BWN3w`) was absent in the build — but the manifest only
anchored the two tiers, not `.tb-c` itself, so it was a blind spot. **Coverage equals anchor
completeness**: the tool only checks props you anchor. Adding the `.tb-c` anchor surfaced it
(`borderBottomWidth: expected 1, got 0`); fixing `.tb-c` turned it green. So the manifest should
aim to anchor every element + the props that matter for each.
