import { inflateRawSync } from "node:zlib";
import { testFileId } from "../core/keys/reverse-index.js";
import type { Connection } from "../core/store/connection.js";
import { hasImportGraphTables } from "../core/store/import-edges.js";
import { connectionOf } from "../core/store/store.js";
import type { RelativePath } from "../core/types/common.js";
import type { Store } from "../core/types/store.js";
import type { TestFileKeyRecord } from "../core/types/store-records.js";

/*
 * Row 011-403 (gh-242, `tasks/011-402/notes.md`): a named selection the
 * daemon did not answer reads the stored import graph beside the stored
 * closures. A walk is stored under the key it was walked at (015 D11), so
 * the walk at this worktree's current key of a test file is this worktree's
 * whoever wrote it, where the one closure record per test file holds only
 * for its writer's key (001 D6's rule, 011-234 finding 1). Each walk is read
 * at the key of the row the selection read (as `readImportGraph` reads one,
 * but at that row's key), so a key that moves between the two reads never
 * pairs a row with another key's walk.
 */

/** One stored walk entry (`encodeImports`): a visited path, its static and dynamic imports. */
type WalkEntry = [RelativePath, RelativePath[], RelativePath[]];

/** The paths each stored walk visits, by test file and key: a key's walk never changes. */
export class StoredWalks {
  readonly #visited = new Map<string, ReadonlySet<RelativePath>>();

  /**
   * The rows whose walk at their current key visits `rel`: imports it, or
   * is it. A row with no walk at its key (none stored yet, a walk from
   * before the graph tables, a store without them) is not among them.
   */
  readers(
    store: Store,
    rows: readonly TestFileKeyRecord[],
    rel: RelativePath,
  ): TestFileKeyRecord[] {
    let conn: Connection | null | undefined;
    const visited = (row: TestFileKeyRecord): ReadonlySet<RelativePath> | undefined => {
      if (row.key === null) return undefined;
      const id = `${testFileId(row.testFile)}\0${row.key}`;
      const known = this.#visited.get(id);
      if (known !== undefined) return known;
      conn ??= walkConnection(store);
      const stored = conn?.get(
        "SELECT imports FROM test_file_imports WHERE project = ? AND path = ? AND key = ?",
        row.testFile.project,
        row.testFile.path,
        row.key,
      );
      if (stored === null || stored === undefined) return undefined;
      const paths = new Set<RelativePath>();
      for (const [path, statics, dynamics] of decode(stored.imports as Uint8Array)) {
        paths.add(path);
        for (const target of [...statics, ...dynamics]) paths.add(target);
      }
      this.#visited.set(id, paths);
      return paths;
    };
    return rows.filter((row) => visited(row)?.has(rel) === true);
  }
}

function decode(bytes: Uint8Array): WalkEntry[] {
  return JSON.parse(inflateRawSync(bytes).toString("utf8")) as WalkEntry[];
}

/** The store's connection when it holds the graph tables; `null` otherwise, or for a test's fake store. */
function walkConnection(store: Store): Connection | null {
  try {
    const conn = connectionOf(store);
    return hasImportGraphTables(conn) ? conn : null;
  } catch {
    return null;
  }
}
