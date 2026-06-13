import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview";
import { EditorPanel, OutputPane } from "./panels";
import { TerminalPane } from "./TerminalPane";

const components = {
  editor: (_props: IDockviewPanelProps) => <EditorPanel />,
  output: (_props: IDockviewPanelProps) => <OutputPane />,
};

function onReady(event: DockviewReadyEvent) {
  const editor = event.api.addPanel({
    id: "editor",
    component: "editor",
    title: "Editor",
  });
  event.api.addPanel({
    id: "output",
    component: "output",
    title: "Output",
    position: { referencePanel: "editor", direction: "right" },
  });
  editor.api.setActive();
}

export function Workbench() {
  return (
    <div className="workbench-inner">
      <div className="dock-area">
        <DockviewReact
          className="dockview-theme-abyss sz-dockview"
          components={components}
          onReady={onReady}
        />
      </div>
      <TerminalPane />
    </div>
  );
}
