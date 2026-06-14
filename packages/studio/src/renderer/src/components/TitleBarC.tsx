import { Box, Check, ChevronDown, Folder, Moon } from "lucide-react";
import { useState } from "react";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { APP_MENUS } from "./titlebarMenus";
import { TrafficLights, WindowControls } from "./WindowControls";

// Canonical titlebar — Variation C (two-tier), from design/specs/titlebar.md + app.pen.
// Tier 1 = window chrome: logo + wordmark + app menus (open dropdowns) + window controls.
// Tier 2 = project/connection context + drift + account.
// Web/WASM build: no window controls, connection reads "Sandbox / mem://", drift chip hidden.
// Platform: macOS = traffic-lights flush left; Windows/Linux = controls flush right.
export function TitleBarC() {
  const isWeb = !window.studio;
  const isMac = window.studio?.platform === "darwin";
  const [menu, setMenu] = useState<{ x: number; y: number; i: number } | null>(
    null,
  );

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, i });
  };

  return (
    <div className="tb-c">
      <div className="tb-c-tier1">
        {isMac && <TrafficLights />}
        <div className="tb-c-left no-drag">
          <span className="tb-logo">
            <Moon size={10} />
          </span>
          <span className="tb-wordmark">Reverie</span>
          <nav className="tb-menus" aria-label="Application menu">
            {APP_MENUS.map((m, i) => (
              <button
                type="button"
                key={m.label}
                className={`tb-menu${menu?.i === i ? " open" : ""}`}
                onClick={(e) => openMenu(e, i)}
              >
                {m.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="tb-spacer" />
        {!isMac && <WindowControls />}
      </div>
      <div className="tb-c-tier2">
        <button type="button" className="ctx-switcher no-drag">
          <span className="ctx-glyph">
            <Folder size={10} />
          </span>
          <span className="ctx-ws">Personal</span>
          <span className="ctx-sep">/</span>
          <span className="ctx-name">credilisto</span>
          <ChevronDown size={14} className="muted" />
        </button>
        <button type="button" className="ctx-switcher no-drag">
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
        <div className="tb-spacer" />
        {!isWeb && (
          <button type="button" className="drift-chip no-drag">
            <Check size={13} />
            In sync
          </button>
        )}
        {isWeb && (
          <span className="drift-chip sandbox no-drag">
            <Box size={13} />
            Sandbox
          </span>
        )}
        <button type="button" className="account-badge no-drag">
          M
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={APP_MENUS[menu.i].items as MenuItem[]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
