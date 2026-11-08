import type { CommitSha, EpochMs, ProjectName, RelativePath } from "../types/common.js";
import type { CheckKey, EnvironmentHash } from "../types/keys.js";
import type { Store } from "../types/store.js";
import type { Connection, Row } from "./connection.js";
import { connectionOf } from "./store.js";

/*
 * Spec 018 D3 step 1 and D5: what each `squeal import` added, so status can
 * name the import a result came from and count its files. Additive
 * main-store tables, made by the first import, with no `user_version` raise;
 * no key reads them, so they live outside `schema.ts`, which the key-format
 * alarm bundles (the pattern of `IMPORT_GRAPH_TABLES`).
 *
 * - `imports`: by import id, the export's header as JSON, the file's hash
 *   and when it was imported.
 * - `import_files`: by import and test file, the exported key, the
 *   environment hash of its project, and one hash each of its closure list
 *   and observed entries, as the export held them (D5's reasons).
 */
export const IMPORT_TABLES: Readonly<Record<string, string>> = {
  imports: `
CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  header TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  imported_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
`,
  import_files: `
CREATE TABLE import_files (
  import_id TEXT NOT NULL,
  project TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  environment TEXT NOT NULL,
  closure TEXT NOT NULL,
  observed TEXT NOT NULL,
  PRIMARY KEY (import_id, project, path)
) STRICT, WITHOUT ROWID;
`,
};

/** Where an export came from, as its header records it (018 D2). */
export type ExportSource =
  | {
      readonly kind: "github";
      readonly repository: string | null;
      readonly runId: string | null;
      readonly ref: string | null;
      readonly event: string | null;
      readonly sha: string | null;
    }
  | { readonly kind: "local" };

/** An export's header (018 D2). */
export interface ExportHeader {
  readonly squealVersion: string;
  readonly keyFormat: number;
  readonly commit: CommitSha;
  readonly dirty: boolean;
  readonly createdAt: EpochMs;
  readonly source: ExportSource;
}

/** One import, as stored. */
export interface ImportRecord {
  readonly id: string;
  readonly header: ExportHeader;
  readonly fileHash: string;
  readonly importedAt: EpochMs;
}

/** One exported test file of an import, as stored. */
export interface ImportFileRecord {
  readonly importId: string;
  readonly project: ProjectName;
  readonly path: RelativePath;
  readonly key: CheckKey;
  readonly environment: EnvironmentHash;
  /** The hash of the export's closure list (`listHash`), `""` when it held none. */
  readonly closure: string;
  /** The hash of the export's observed entries (`listHash`). */
  readonly observed: string;
}

/**
 * Spec 018 D4: `CI run <id> on <repository> at <commit8>`, or `local export
 * at <commit8>`.
 */
export function sourceLabel(header: ExportHeader): string {
  const at = header.commit === null ? "an unborn commit" : header.commit.slice(0, 8);
  if (header.source.kind === "local") return `local export at ${at}`;
  const { runId, repository } = header.source;
  return `CI run ${runId ?? "?"} on ${repository ?? "an unnamed repository"} at ${at}`;
}

/** Whether `conn`'s database holds every `IMPORT_TABLES` table. */
function hasTables(conn: Connection): boolean {
  const found = conn.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (SELECT value FROM json_each(?))",
    JSON.stringify(Object.keys(IMPORT_TABLES)),
  );
  return found.length === Object.keys(IMPORT_TABLES).length;
}

/** Makes each absent `IMPORT_TABLES` table; called inside the importer's transaction. */
export function ensureImportTables(conn: Connection): void {
  if (hasTables(conn)) return;
  for (const [name, sql] of Object.entries(IMPORT_TABLES)) {
    if (conn.get("SELECT 1 AS found FROM sqlite_master WHERE name = ?", name) === null) {
      conn.db.exec(sql);
    }
  }
}

/** `store`'s connection with the tables made, or `null` for a store without them or a test's fake. */
function readable(store: Store): Connection | null {
  let conn: Connection;
  try {
    conn = connectionOf(store);
  } catch {
    return null;
  }
  return hasTables(conn) ? conn : null;
}

/** Every import, newest first; empty before the first. A header this release cannot read is left out. */
export function listImports(store: Store): ImportRecord[] {
  const conn = readable(store);
  if (conn === null) return [];
  return conn.all("SELECT * FROM imports ORDER BY imported_at DESC, id").flatMap((row) => {
    const header = parseHeader(row.header);
    return header === null
      ? []
      : [
          {
            id: String(row.id),
            header,
            fileHash: String(row.file_hash),
            importedAt: Number(row.imported_at),
          },
        ];
  });
}

/**
 * Spec 018 D4: each import's source label by id, read at the first ask, for
 * naming imported results; `null` for an import the store holds no row of.
 */
export function importSourceOf(store: Store): (importId: string) => string | null {
  let labels: Map<string, string> | undefined;
  return (importId) => {
    labels ??= new Map(listImports(store).map((i) => [i.id, sourceLabel(i.header)]));
    return labels.get(importId) ?? null;
  };
}

/** The exported test files of `importId`, by project and path. */
export function importFiles(store: Store, importId: string): ImportFileRecord[] {
  const conn = readable(store);
  if (conn === null) return [];
  return conn
    .all("SELECT * FROM import_files WHERE import_id = ? ORDER BY project, path", importId)
    .map(toImportFile);
}

function toImportFile(row: Row): ImportFileRecord {
  return {
    importId: String(row.import_id),
    project: String(row.project),
    path: String(row.path),
    key: String(row.key),
    environment: String(row.environment),
    closure: String(row.closure),
    observed: String(row.observed),
  };
}

/** A stored header, or `null` when it is not one this release reads. */
export function parseHeader(text: unknown): ExportHeader | null {
  if (typeof text !== "string") return null;
  try {
    const value: unknown = JSON.parse(text);
    return isHeader(value) ? value : null;
  } catch {
    return null;
  }
}

/** Whether `value` has an export header's shape. */
export function isHeader(value: unknown): value is ExportHeader {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Record<string, unknown>;
  const source = h.source as Record<string, unknown> | null | undefined;
  return (
    typeof h.squealVersion === "string" &&
    typeof h.keyFormat === "number" &&
    (typeof h.commit === "string" || h.commit === null) &&
    typeof h.dirty === "boolean" &&
    typeof h.createdAt === "number" &&
    typeof source === "object" &&
    source !== null &&
    (source.kind === "local" || source.kind === "github")
  );
}
