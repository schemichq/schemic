// Tiny ANSI styling, gated on a TTY and honoring NO_COLOR. No dependency.
/** Whether colored output is enabled (a TTY and `NO_COLOR` unset). */
export const colorEnabled = () =>
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: number, s: string) =>
  colorEnabled() ? `\x1b[${code}m${s}\x1b[0m` : s;

export const style = {
  green: (s: string) => paint(32, s),
  red: (s: string) => paint(31, s),
  yellow: (s: string) => paint(33, s),
  cyan: (s: string) => paint(36, s),
  dim: (s: string) => paint(90, s),
  bold: (s: string) => paint(1, s),
};

/** A green ✓ success line. */
export const ok = (s: string) => `${style.green("✓")} ${s}`;
/** A red ✗ failure line. */
export const fail = (s: string) => `${style.red("✗")} ${s}`;

/** Pluralize `n thing` / `n things`. */
export const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;
