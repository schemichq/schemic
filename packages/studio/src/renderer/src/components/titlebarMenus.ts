import { runCommand } from "../commands/registry";
import type { MenuItem } from "./MenuRow";

// App-menu definitions for the titlebar (File · Edit · View · Schema · Connection · Help),
// per design/specs/titlebar.md. Items wire to the command registry where a command exists;
// designed-but-unwired actions are shown disabled (muted). Shared by C (menu bar) and B
// (collapsed "Menu" dropdown).

export interface AppMenu {
  label: string;
  items: MenuItem[];
}

export const APP_MENUS: AppMenu[] = [
  {
    // Matches the designed File menu (app.pen Y5eVhC). Actions without a built flow are
    // disabled (muted) per "surface only what's implemented" — enable as the flows ship.
    label: "File",
    items: [
      { label: "New Project…", shortcut: "Cmd N", disabled: true },
      {
        label: "Open Folder…",
        shortcut: "Cmd O",
        onClick: () => runCommand("project.open"),
      },
      { label: "Open Recent", submenu: true, disabled: true },
      "sep",
      { label: "Pull from DB", disabled: true },
      { label: "Push to DB", disabled: true },
      "sep",
      { label: "Settings…", shortcut: "Cmd ,", disabled: true },
      {
        label: "Quit Reverie",
        shortcut: "Cmd Q",
        onClick: () => window.studio?.window.close(),
      },
    ],
  },
  {
    label: "Edit",
    items: [
      {
        label: "Undo",
        shortcut: "Cmd Z",
        onClick: () => document.execCommand("undo"),
      },
      {
        label: "Redo",
        shortcut: "Cmd Shift Z",
        onClick: () => document.execCommand("redo"),
      },
      "sep",
      {
        label: "Cut",
        shortcut: "Cmd X",
        onClick: () => document.execCommand("cut"),
      },
      {
        label: "Copy",
        shortcut: "Cmd C",
        onClick: () => document.execCommand("copy"),
      },
      {
        label: "Paste",
        shortcut: "Cmd V",
        onClick: () => document.execCommand("paste"),
      },
    ],
  },
  {
    label: "View",
    items: [
      {
        label: "Command Palette…",
        shortcut: "Cmd K",
        onClick: () => runCommand("command.palette"),
      },
      "sep",
      {
        label: "Switch Title Bar Style",
        onClick: () => runCommand("titlebar.switchStyle"),
      },
    ],
  },
  {
    label: "Schema",
    items: [
      {
        label: "Run Query",
        shortcut: "Cmd Enter",
        onClick: () => runCommand("query.run"),
      },
    ],
  },
  {
    label: "Connection",
    items: [{ label: "Manage Connections…", disabled: true }],
  },
  {
    label: "Help",
    items: [
      { label: "Documentation", disabled: true },
      { label: "About Reverie", disabled: true },
    ],
  },
];
