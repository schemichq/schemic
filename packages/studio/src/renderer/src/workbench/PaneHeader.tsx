import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Database,
  Loader2,
  Lock,
  type LucideIcon,
  RefreshCw,
  SquareTerminal,
  Table2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Reusable pane header matching design/app.pen `Pane Header` (ooDTM): type icon +
// accent-underlined title + type-switcher dropdown, then copy (+ lock when read-only).
// Detach / collapse and the dropdown's inline split/detach actions are Slice 3.

export type PaneType = "surrealql" | "result" | "terminal" | "problems";

export const PANE_TYPES: Record<
  PaneType,
  { label: string; icon: LucideIcon; color: string }
> = {
  surrealql: { label: "SurrealQL", icon: Database, color: "var(--code-type)" },
  result: { label: "Result", icon: Table2, color: "var(--code-fn)" },
  terminal: {
    label: "Terminal",
    icon: SquareTerminal,
    color: "var(--text-muted)",
  },
  problems: {
    label: "Problems",
    icon: AlertTriangle,
    color: "var(--warning-amber)",
  },
};

const TYPE_ORDER: PaneType[] = ["surrealql", "result", "terminal", "problems"];

export function PaneHeader({
  type,
  onSwitchType,
  readOnly,
  onCopy,
  onRefresh,
  loading,
}: {
  type: PaneType;
  onSwitchType: (t: PaneType) => void;
  readOnly?: boolean;
  onCopy?: () => void;
  onRefresh?: () => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const meta = PANE_TYPES[type];
  const Icon = meta.icon;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="pane-header">
      <div className="pane-switch" ref={ref}>
        <button
          type="button"
          className="pane-title"
          onClick={() => setOpen((o) => !o)}
        >
          <Icon size={14} style={{ color: meta.color }} />
          <span className="pane-title-text">{meta.label}</span>
          <ChevronDown size={13} className="pane-chevron" />
        </button>
        {open && (
          <div className="pane-menu" role="menu">
            {TYPE_ORDER.map((t) => {
              const m = PANE_TYPES[t];
              const TIcon = m.icon;
              return (
                <button
                  type="button"
                  key={t}
                  className={`pane-menu-item${t === type ? " selected" : ""}`}
                  onClick={() => {
                    onSwitchType(t);
                    setOpen(false);
                  }}
                >
                  <TIcon size={14} style={{ color: m.color }} />
                  <span>{m.label}</span>
                  {t === type && (
                    <Check size={13} className="pane-menu-check" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="pane-spacer" />
      {loading && <Loader2 size={13} className="pane-icon pane-spin" />}
      {readOnly && <Lock size={12} className="pane-icon" />}
      {onRefresh && (
        <button
          type="button"
          className="pane-action"
          title="Regenerate"
          onClick={onRefresh}
        >
          <RefreshCw size={13} />
        </button>
      )}
      {onCopy && (
        <button
          type="button"
          className="pane-action"
          title="Copy"
          onClick={onCopy}
        >
          <Copy size={13} />
        </button>
      )}
    </div>
  );
}
