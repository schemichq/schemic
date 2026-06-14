import { useEffect, useRef } from "react";

// Lightweight positioned popup menu (right-click / overflow). Dismisses on outside-click,
// Esc, or scroll/resize. Items can be a separator ("sep") or an action.

export type MenuItem =
  | "sep"
  | { label: string; shortcut?: string; danger?: boolean; onClick: () => void };

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Keep the menu on-screen (flip near the right/bottom edges).
  const W = 200;
  const left = Math.min(x, window.innerWidth - W - 8);
  const top = Math.min(y, window.innerHeight - items.length * 30 - 8);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left, top, width: W }}
    >
      {items.map((it, i) =>
        it === "sep" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: separators are positional
          <div key={`sep-${i}`} className="ctx-sep" />
        ) : (
          <button
            type="button"
            key={it.label}
            role="menuitem"
            className={`ctx-item${it.danger ? " danger" : ""}`}
            onClick={() => {
              it.onClick();
              onClose();
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
