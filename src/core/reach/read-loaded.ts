import { num, str } from "../store/codec.js";
import { LOADED_MODULES_TABLE, type LoadedModule } from "../store/loaded-modules.js";
import { connectionOf } from "../store/store.js";
import type { TestFileRef } from "../types/keys.js";
import type { Store } from "../types/store.js";
import type { LoadedList } from "./types.js";

/*
 * Spec 022 D4: the stored loaded lists (D3) as `squeal reach` reads them,
 * by test file, oldest first. Read only. A store with no `loaded_modules`
 * table (an older daemon wrote it, or no list was recorded yet) reads no
 * lists.
 */

export function readLoadedLists(store: Store): (ref: TestFileRef) => readonly LoadedList[] {
  const conn = connectionOf(store);
  const table = conn.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    LOADED_MODULES_TABLE,
  );
  const lists = new Map<string, LoadedList[]>();
  if (table.length > 0) {
    const rows = conn.all(
      `SELECT project, path, recorded_at, modules FROM ${LOADED_MODULES_TABLE} ORDER BY recorded_at`,
    );
    for (const row of rows) {
      const id = refId({ project: str(row, "project"), path: str(row, "path") });
      const modules = parseModules(str(row, "modules"));
      if (modules === null) continue;
      const list = { at: num(row, "recorded_at"), paths: new Set(modules.map((m) => m.path)) };
      lists.set(id, [...(lists.get(id) ?? []), list]);
    }
  }
  return (ref) => lists.get(refId(ref)) ?? [];
}

const refId = (ref: TestFileRef) => `${ref.project}\0${ref.path}`;

/** The stored JSON; `null` when it does not read as a list of modules. */
function parseModules(text: string): readonly LoadedModule[] | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return null;
    return value.filter(
      (m): m is LoadedModule => typeof m === "object" && m !== null && typeof m.path === "string",
    );
  } catch {
    return null;
  }
}
