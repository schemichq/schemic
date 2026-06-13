// Capability interface: generate SurrealQL DDL from a schema file. On desktop this is
// IPC to the main process (jiti runs the user's TS); the web playground has no codegen
// yet. Async so the impl can be in-process or IPC-backed transparently. (Engine bridge.)

export interface CodegenResult {
  ok: boolean;
  surql?: string;
  error?: string;
}

export interface Codegen {
  readonly id: string;
  /** Generate SurrealQL from the schema file on disk (regenerate after saving). */
  fromFile(path: string): Promise<CodegenResult>;
}
