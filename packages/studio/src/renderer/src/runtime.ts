import type { Codegen } from "./adapters/Codegen";
import { IpcCodegen } from "./adapters/codegen/IpcCodegen";
import { WasmQueryEngine } from "./adapters/engines/WasmQueryEngine";
import type { FileSystem } from "./adapters/FileSystem";
import { LocalFS } from "./adapters/fs/LocalFS";
import type { LanguageService } from "./adapters/LanguageService";
import { BundledTypesLanguageService } from "./adapters/lsp/BundledTypesLanguageService";
import { TsServerLanguageService } from "./adapters/lsp/TsServerLanguageService";
import type { QueryEngine } from "./adapters/QueryEngine";

// Runtime profile: binds capability adapters for the active mode. For now there is
// one profile (playground = wasm in renderer). Desktop/remote profiles and the
// FileSystem/Terminal/SecretStore adapters are added as they are implemented. (D34)
let queryEngine: QueryEngine | null = null;

export function getQueryEngine(): QueryEngine {
  if (!queryEngine) queryEngine = new WasmQueryEngine();
  return queryEngine;
}

let fileSystem: FileSystem | null = null;

export function getFileSystem(): FileSystem {
  if (!fileSystem) fileSystem = new LocalFS();
  return fileSystem;
}

let codegen: Codegen | null = null;

export function getCodegen(): Codegen {
  if (!codegen) codegen = new IpcCodegen();
  return codegen;
}

let languageService: LanguageService | null = null;

export function getLanguageService(): LanguageService {
  if (!languageService) {
    // Desktop has a real tsserver over IPC; the web/embedded build falls back to
    // Monaco's built-in worker + bundled ambient types.
    languageService = window.studio?.lsp
      ? new TsServerLanguageService(window.studio.lsp)
      : new BundledTypesLanguageService();
  }
  return languageService;
}
