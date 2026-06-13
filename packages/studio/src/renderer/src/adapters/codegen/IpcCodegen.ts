import type { Codegen, CodegenResult } from "../Codegen";

// Desktop codegen: forwards to the main process over IPC (window.studio.codegen),
// which runs surreal-zod's emit over the jiti-loaded schema.
export class IpcCodegen implements Codegen {
  readonly id = "ipc";

  async fromFile(path: string): Promise<CodegenResult> {
    if (!window.studio?.codegen) {
      return {
        ok: false,
        error: "Codegen is only available in the desktop app.",
      };
    }
    return window.studio.codegen.fromFile(path);
  }
}
