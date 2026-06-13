import type * as Monaco from "monaco-editor";
import type { LanguageService } from "../LanguageService";

// Embedded/web fallback: no tsserver, so keep Monaco's built-in TS worker and declare the
// surreal-zod / surrealdb / zod modules ambiently. Imports resolve (typed `any`) — no false
// "Cannot find module", but no real autocomplete. Real types ship as a bundled .d.ts later.
export class BundledTypesLanguageService implements LanguageService {
  readonly id = "bundled-types";

  install(monaco: typeof Monaco): void {
    // `monaco.languages.typescript` is typed deprecated in the ESM build (the full
    // namespace lives in the global d.ts), so reach it via a minimal cast + numeric enums.
    const tsDefaults = (
      monaco.languages as unknown as {
        typescript: {
          typescriptDefaults: {
            setCompilerOptions(o: Record<string, unknown>): void;
            addExtraLib(content: string, filePath: string): void;
          };
        };
      }
    ).typescript.typescriptDefaults;
    tsDefaults.setCompilerOptions({
      target: 99, // ESNext
      module: 99, // ESNext
      moduleResolution: 2, // NodeJs
      allowNonTsExtensions: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      strict: false,
    });
    tsDefaults.addExtraLib(
      'declare module "surreal-zod";\ndeclare module "surrealdb";\ndeclare module "zod";\n',
      "file:///reverie/ambient-modules.d.ts",
    );
  }
}
