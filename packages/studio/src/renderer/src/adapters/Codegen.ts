// Capability interface: generate SurrealQL DDL from a schema file. On desktop this is
// IPC to the main process (jiti runs the user's TS); the web playground has no codegen
// yet. Async so the impl can be in-process or IPC-backed transparently. (Engine bridge.)

/** One source<->generated line link (1-based) for cursor sync. */
export interface SourceMapEntry {
  kind: string;
  name: string;
  sourceLine: number;
  genLine: number;
}

export interface CodegenResult {
  ok: boolean;
  surql?: string;
  error?: string;
  map?: SourceMapEntry[];
}

export interface Codegen {
  readonly id: string;
  /** Generate SurrealQL; pass the in-memory `content` to preview unsaved edits live. */
  fromFile(path: string, content?: string): Promise<CodegenResult>;
}
