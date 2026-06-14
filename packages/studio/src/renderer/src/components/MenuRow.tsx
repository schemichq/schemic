import { ChevronRight } from "lucide-react";

// One dropdown row (the reusable "Menu Row" from design/app.pen, i0l2op): label + a trailing
// shortcut or submenu chevron, with hover / disabled / danger states. Backs both the titlebar
// app menus and the explorer context menu.

export type MenuItem =
  | "sep"
  | {
      label: string;
      shortcut?: string;
      submenu?: boolean;
      danger?: boolean;
      disabled?: boolean;
      onClick?: () => void;
    };

export function MenuRow({
  item,
  onSelect,
}: {
  item: Exclude<MenuItem, "sep">;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      className={`ctx-item${item.danger ? " danger" : ""}`}
      onClick={() => {
        if (item.disabled) return;
        item.onClick?.();
        // Submenu parents expand in place; leaf items dismiss the menu.
        if (!item.submenu) onSelect();
      }}
    >
      <span>{item.label}</span>
      {item.submenu ? (
        <ChevronRight size={13} className="ctx-chevron" />
      ) : item.shortcut ? (
        <span className="ctx-shortcut">{item.shortcut}</span>
      ) : null}
    </button>
  );
}
