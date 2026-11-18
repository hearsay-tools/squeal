import type { RelativePath } from "../types/common.js";
import type { RunnerAdapter } from "../types/runner.js";
import type { KeyingOptions } from "./at-keys-walk.js";

/*
 * Rows 023-06 and 023-08: a checkout's adapters, each listing only the
 * test files some paths select, so the keying there keys only those, under
 * each project that lists them at that commit; keying is the adapters'
 * own, unchanged (the keying maps each listed file to its adapter and keys
 * it by its own closure, so a narrower listing changes no key).
 */

/** Whether `paths` select `path`: the file itself, or a file below a named folder. */
export function selects(paths: readonly RelativePath[], path: RelativePath): boolean {
  return paths.some((p) => p === "" || p === path || path.startsWith(`${p.replace(/\/+$/, "")}/`));
}

/** `adapters`, each listing only the test files `paths` select. */
export function narrowed(
  adapters: KeyingOptions["adapters"],
  paths: readonly RelativePath[],
): KeyingOptions["adapters"] {
  return async (root, policy, tempDir) =>
    (await adapters(root, policy, tempDir)).map((adapter) => listingOnly(adapter, paths));
}

function listingOnly(adapter: RunnerAdapter, paths: readonly RelativePath[]): RunnerAdapter {
  return new Proxy(adapter, {
    get(target, name) {
      if (name === "testFiles") {
        return async () => (await target.testFiles()).filter((ref) => selects(paths, ref.path));
      }
      const value: unknown = Reflect.get(target, name, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Row 023-19 (P4): `adapters` narrowed to `paths`'s test files when each
 * path selects a test file one of them lists; else unnarrowed, so every
 * listed file is keyed and a caller selects by closure. `sources` hears
 * the paths that select no listed test file and that `holds` (source
 * paths), once the adapters are made: a path the tree lacks is in no
 * closure, and keys nothing more.
 */
export function narrowedOrAll(
  adapters: KeyingOptions["adapters"],
  paths: readonly RelativePath[],
  holds: (path: RelativePath) => boolean,
  sources: (paths: readonly RelativePath[]) => void,
): KeyingOptions["adapters"] {
  return async (root, policy, tempDir) => {
    const made = await adapters(root, policy, tempDir);
    const listed = (await Promise.all(made.map((adapter) => adapter.testFiles()))).flat();
    const named = paths.filter(
      (path) => holds(path) && !listed.some((ref) => selects([path], ref.path)),
    );
    sources(named);
    return named.length > 0 ? made : made.map((adapter) => listingOnly(adapter, paths));
  };
}
