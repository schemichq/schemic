import { ChevronDown, Folder, Moon, Search } from "lucide-react";
import { useState } from "react";
import { runCommand } from "../commands/registry";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { APP_MENUS } from "./titlebarMenus";
import { TrafficLights, WindowControls } from "./WindowControls";

// Canonical titlebar — Variation B (switcher-centric, single tier), from design/specs/titlebar.md.
// Collapsed "Menu" opens a dropdown of the top-level menus (submenu chevrons) that expand in
// place into their items. Web: no window controls + Sandbox connection. Platform: macOS
// traffic-lights left / Windows-Linux controls right.
export function TitleBarB() {
  const isWeb = !window.studio;
  const isMac = window.studio?.platform === "darwin";
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  // Top-level list: each menu is a submenu parent that swaps in its own items on click.
  const openMenuList = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at = { x: r.left, y: r.bottom + 4 };
    const items: MenuItem[] = APP_MENUS.map((m) => ({
      label: m.label,
      submenu: true,
      onClick: () => setMenu({ ...at, items: m.items }),
    }));
    setMenu({ ...at, items });
  };

  return (
    <div className="tb-b">
      {isMac && <TrafficLights />}
      <div className="tb-b-left no-drag">
        <span className="tb-logo tb-logo-lg">
          <Moon size={15} />
        </span>
        <span className="tb-wordmark">Reverie</span>
        <button
          type="button"
          className={`tb-menu-collapsed${menu ? " open" : ""}`}
          onClick={openMenuList}
        >
          Menu
          <ChevronDown size={13} className="muted" />
        </button>
      </div>
      <div className="tb-spacer" />
      <div className="tb-seg no-drag">
        <button type="button" className="tb-seg-part">
          <span className="ctx-glyph">
            <Folder size={10} />
          </span>
          <span className="ctx-ws">Personal</span>
          <span className="ctx-sep">/</span>
          <span className="ctx-name">credilisto</span>
          <ChevronDown size={14} className="muted" />
        </button>
        <span className="tb-seg-divider" />
        <button type="button" className="tb-seg-part">
          {isWeb ? (
            <>
              <span className="conn-dot2 sandbox" />
              <span className="ctx-env">Sandbox</span>
              <span className="ctx-endpoint">mem://</span>
            </>
          ) : (
            <>
              <span className="conn-dot2" />
              <span className="ctx-env">dev</span>
              <span className="ctx-endpoint">ws://localhost:8000</span>
            </>
          )}
          <ChevronDown size={14} className="muted" />
        </button>
      </div>
      <div className="tb-spacer" />
      <div className="tb-b-right no-drag">
        <button
          type="button"
          className="tb-icon-btn"
          aria-label="Command palette"
          onClick={() => runCommand("command.palette")}
        >
          <Search size={16} />
        </button>
        <button type="button" className="account-badge">
          M
        </button>
        {!isMac && (
          <>
            <span className="tb-b-divider" />
            <WindowControls />
          </>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
