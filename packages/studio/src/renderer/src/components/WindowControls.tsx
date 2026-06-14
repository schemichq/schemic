import { Minus, Square, X } from "lucide-react";

// macOS traffic-light window controls: three dots flush LEFT (close / minimize / maximize),
// per the platform-controls spec. Electron-only (null on web). Windows/Linux use WindowControls.
export function TrafficLights() {
  const win = window.studio?.window;
  if (!win) return null;
  return (
    <div className="tb-traffic no-drag">
      <button
        type="button"
        className="tl-dot close"
        aria-label="Close"
        onClick={() => win.close()}
      />
      <button
        type="button"
        className="tl-dot min"
        aria-label="Minimize"
        onClick={() => win.minimize()}
      />
      <button
        type="button"
        className="tl-dot max"
        aria-label="Maximize"
        onClick={() => win.maximize()}
      />
    </div>
  );
}

// Custom Reverie window controls. Rendered only in the Electron (frameless) build;
// the web build has no OS window controls (returns null).
export function WindowControls() {
  const win = window.studio?.window;
  if (!win) return null;
  return (
    <div className="win-ctls no-drag">
      <button
        type="button"
        className="win-ctl"
        aria-label="Minimize"
        onClick={() => win.minimize()}
      >
        <Minus size={16} />
      </button>
      <button
        type="button"
        className="win-ctl"
        aria-label="Maximize"
        onClick={() => win.maximize()}
      >
        <Square size={13} />
      </button>
      <button
        type="button"
        className="win-ctl close"
        aria-label="Close"
        onClick={() => win.close()}
      >
        <X size={16} />
      </button>
    </div>
  );
}
