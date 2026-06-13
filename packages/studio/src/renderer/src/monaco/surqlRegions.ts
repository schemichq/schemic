// Locate surql`...` tagged templates in TS/JS source. Standalone (no SURQL_KEYWORDS import)
// so it can be used from both the highlighter and the template LSP without an import cycle.

/** A surql`...` template's char offsets: the body (inside the backticks) and the full match. */
export interface SurqlRegion {
  open: number;
  close: number;
  bodyStart: number;
  bodyEnd: number;
}

// Whole surql`...` template (no nested backticks — typical for surql usage). `s` so it
// spans multiple lines; the inner content is capture group 1.
const TEMPLATE_RE = /\bsurql`((?:[^`\\]|\\.)*)`/gs;

/** Find every surql`...` template in `text` and return body + full-match offsets. */
export function surqlRegions(text: string): SurqlRegion[] {
  const out: SurqlRegion[] = [];
  for (const m of text.matchAll(TEMPLATE_RE)) {
    const inner = m[1];
    if (inner === undefined) continue;
    const open = m.index ?? 0;
    const bodyStart = open + (m[0].length - inner.length - 1);
    out.push({
      open,
      close: open + m[0].length,
      bodyStart,
      bodyEnd: bodyStart + inner.length,
    });
  }
  return out;
}
