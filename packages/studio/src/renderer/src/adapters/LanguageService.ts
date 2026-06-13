import type * as Monaco from "monaco-editor";

// Capability interface: the editor's TypeScript/JS language features. Two impls:
//   - TsServerLanguageService (desktop): a real tsserver child process reads the opened
//     project from disk — true autocomplete / hover / diagnostics.
//   - BundledTypesLanguageService (embedded/web): Monaco's built-in TS worker + ambient
//     module declarations (no real node_modules; imports are typed `any`).
// `install` is called once with the monaco namespace after it loads.

export interface LanguageService {
  readonly id: string;
  install(monaco: typeof Monaco): void;
}
