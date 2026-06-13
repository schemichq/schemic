import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "dockview/dist/styles/dockview.css";
import "./monaco/setup";
import "./theme.css";
import "./commands/defs"; // register built-in commands (side effect)
import "./keybindings/defs"; // register built-in keybindings (side effect)
import "./statusbar/defs"; // register built-in status-bar segments (side effect)
import { App } from "./App";
import { useStudio } from "./store";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true } }}>
      <App />
    </HotkeysProvider>
  </StrictMode>,
);

// Dev/e2e seam: expose the store for inspection + automation.
(window as unknown as { __studio?: typeof useStudio }).__studio = useStudio;
