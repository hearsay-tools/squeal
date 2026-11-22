import { compare } from "../fs/compare.js";
import { plural } from "../text.js";
import type { RelativePath } from "../types/common.js";
import { isConfigPath } from "./names.js";
import { BROAD_READS, isBroadPair, OBSERVED_KINDS, readerText } from "./observers.js";
import type { Pair, PathKind } from "./pairs.js";
import type { GatewayEntry, GatewayMode } from "./report-types.js";
import type { DeclaredPattern, ReachEdit } from "./types.js";

/*
 * Spec 015 D11 as amended 2026-11-22 (row 015-128): the top gateways by
 * the seconds the window's edits re-ran, across every edited file. Each
 * edit counts a test file once per gateway, however many of its files
 * reach it there. A pair's gateway: its setup root (`chain[0]`), its test
 * helper, its barrel, its declared pattern, its transitive hub, or, for an
 * observed pair, the path read or the broad reader's group.
 */

/** What the entries read of the analysis. */
export interface GatewayInput {
  readonly kept: readonly ReachEdit[];
  readonly rerunSeconds: number;
  /** Each broad reader's group (`broadGroups`). */
  readonly readers: ReadonlyMap<RelativePath, string>;
  /** The suite's test file at an index: its `(project, path)` id, path, recorded seconds, and modules outside its walk. */
  readonly tests: (index: number) => {
    readonly id: string;
    readonly path: RelativePath;
    readonly seconds: number;
    readonly outside: number;
  };
  readonly edits: ReadonlyMap<RelativePath, number>;
}

interface Group {
  readonly kind: PathKind;
  readonly gateway: string;
  readonly mode?: GatewayMode;
  readonly declared?: DeclaredPattern;
  /** A broad reader's test file, whose group is known once every test file is read. */
  readonly reader?: RelativePath;
}

/** The pairs of edited files, by gateway. */
export class GatewayPairs {
  /** Per edited path, per gateway key, the suite's indexes of its test files there. */
  readonly #byPath = new Map<RelativePath, Map<string, Set<number>>>();
  readonly #groups = new Map<string, Group>();

  /** Adds `pair` of the suite's test file at `index`, which re-runs on `outside` modules outside its walk. */
  add(pair: Pair, test: RelativePath, index: number, outside: number): void {
    const group = groupOf(pair, test, outside);
    if (group === null) return;
    const key = keyOf(group);
    this.#groups.set(key, group);
    let byKey = this.#byPath.get(pair.path);
    if (byKey === undefined) {
      byKey = new Map();
      this.#byPath.set(pair.path, byKey);
    }
    byKey.set(key, (byKey.get(key) ?? new Set()).add(index));
  }

  /**
   * The entries, by edit seconds; `readers` names each broad reader's
   * group, `tests` gives each test file of the suite, `edits` each path's
   * edits in the window.
   */
  entries(input: GatewayInput): GatewayEntry[] {
    const { byPath, groups } = this.#merged(input.readers);
    const totals = new Map<string, { seconds: number; edits: number; tests: Set<number> }>();
    for (const edit of input.kept) {
      const sets = new Map<string, Set<number>[]>();
      for (const path of edit.paths) {
        for (const [key, set] of byPath.get(path) ?? [])
          sets.set(key, [...(sets.get(key) ?? []), set]);
      }
      for (const [key, parts] of sets) {
        const union =
          parts.length === 1 ? (parts[0] as Set<number>) : new Set(parts.flatMap((p) => [...p]));
        const total = totals.get(key) ?? { seconds: 0, edits: 0, tests: new Set<number>() };
        for (const index of union) {
          total.seconds += input.tests(index).seconds;
          total.tests.add(index);
        }
        total.edits++;
        totals.set(key, total);
      }
    }
    const files = new Map<string, RelativePath[]>();
    for (const [path, byKey] of byPath) {
      for (const key of byKey.keys()) {
        const known = files.get(key);
        if (known === undefined) files.set(key, [path]);
        else known.push(path);
      }
    }
    const entries = [...totals].map(([key, total]): GatewayEntry => {
      const group = groups.get(key) as Group;
      const edited = (files.get(key) ?? []).sort(
        (a, b) => (input.edits.get(b) ?? 0) - (input.edits.get(a) ?? 0) || compare(a, b),
      );
      const advice = adviceOf(group, edited, [...total.tests].map(input.tests), input.readers);
      return {
        kind: group.kind,
        gateway: group.gateway,
        ...(group.mode === undefined ? {} : { mode: group.mode }),
        ...(group.declared === undefined ? {} : { declared: group.declared }),
        editedFiles: edited.length,
        edits: total.edits,
        testFiles: total.tests.size,
        editSeconds: total.seconds,
        editShare: input.rerunSeconds > 0 ? total.seconds / input.rerunSeconds : 0,
        sampleFiles: edited.slice(0, 3),
        suggestion: advice.suggestion,
        ...(advice.note === undefined ? {} : { note: advice.note }),
      };
    });
    return entries.sort(
      (a, b) =>
        b.editSeconds - a.editSeconds || b.testFiles - a.testFiles || compare(a.gateway, b.gateway),
    );
  }

  /** The broad readers' keys merged into their groups'. */
  #merged(readers: ReadonlyMap<RelativePath, string>) {
    const rename = new Map<string, string>();
    const groups = new Map<string, Group>();
    for (const [key, group] of this.#groups) {
      if (group.reader === undefined) {
        groups.set(key, group);
        continue;
      }
      const resolved: Group = {
        kind: group.kind,
        gateway: readers.get(group.reader) ?? group.reader,
        mode: "broad test reader",
      };
      const merged = keyOf(resolved);
      rename.set(key, merged);
      groups.set(merged, resolved);
    }
    const byPath = new Map<RelativePath, Map<string, Set<number>>>();
    for (const [path, byKey] of this.#byPath) {
      const out = new Map<string, Set<number>>();
      for (const [key, set] of byKey) {
        const to = rename.get(key) ?? key;
        out.set(to, new Set([...(out.get(to) ?? []), ...set]));
      }
      byPath.set(path, out);
    }
    return { byPath, groups };
  }
}

const keyOf = (g: Group) =>
  `${g.kind}\0${g.mode ?? ""}\0${g.reader ?? g.gateway}\0${g.declared?.tests ?? ""}`;

function groupOf(pair: Pair, test: RelativePath, outside: number): Group | null {
  switch (pair.kind) {
    case "setup":
      return { kind: "setup", gateway: pair.chain[0] ?? pair.path };
    case "test helper":
    case "barrel":
    case "transitive":
      return pair.gateway === null ? null : { kind: pair.kind, gateway: pair.gateway };
    case "declared input":
      return pair.declared === undefined
        ? null
        : { kind: pair.kind, gateway: pair.declared.input, declared: pair.declared };
    default:
      if (!OBSERVED_KINDS.has(pair.kind)) return null;
      return isBroadPair(pair, outside)
        ? { kind: pair.kind, gateway: test, mode: "broad test reader", reader: test }
        : { kind: pair.kind, gateway: pair.path, mode: "observed path" };
  }
}

function adviceOf(
  group: Group,
  edited: readonly RelativePath[],
  tests: readonly { readonly id: string; readonly path: RelativePath; readonly outside: number }[],
  readers: ReadonlyMap<RelativePath, string>,
): { readonly suggestion: GatewayEntry["suggestion"]; readonly note?: string } {
  const one = edited.length === 1;
  const them = one ? (edited[0] as string) : "these files";
  const it = one ? "it" : "them";
  const suggest = (text: string) => ({ suggestion: { kind: group.kind, text } });
  const { gateway } = group;
  switch (group.kind) {
    case "setup":
      return isConfigPath(gateway)
        ? suggest(`${gateway} imports ${them}: name ${it} by path, or load ${it} only where used`)
        : suggest(
            `keep the imports of ${gateway} leaf-only, or load ${them} only in the tests that use ${it}`,
          );
    case "test helper":
      return suggest(`split ${gateway}, so each test file loads only the parts it uses`);
    case "barrel":
      return suggest(
        `import ${them} from ${one ? "its own path" : "their own paths"}, or split ${gateway}`,
      );
    case "transitive":
      return suggest(
        `load ${them} only where used: each test file that loads ${gateway} loads ${it} too`,
      );
    case "declared input": {
      const tests = group.declared?.tests ?? null;
      const scope = tests === null ? "every test file" : `the test files "${tests}" matches`;
      return suggest(
        `narrow the input "${gateway}" in squeal.config.json, which gives ${them} to ${scope}`,
      );
    }
    default:
      return { suggestion: null, note: observedText(group, edited, tests, readers) };
  }
}

/** The recorded facts of an observed gateway: who reads or loads what, and how. */
function observedText(
  group: Group,
  edited: readonly RelativePath[],
  tests: readonly { readonly id: string; readonly path: RelativePath; readonly outside: number }[],
  readers: ReadonlyMap<RelativePath, string>,
): string {
  const broad = new Map(
    tests
      .filter((t) => t.outside >= BROAD_READS)
      .map((t) => [t.id, { path: t.path, outside: t.outside }] as const),
  );
  const like = "as tests that start or bundle the program from source do";
  if (group.kind === "child process") {
    return `${plural(tests.length, "test file")} load ${group.mode === "broad test reader" ? plural(edited.length, "edited module") : group.gateway} in a process they start, outside their imports`;
  }
  if (group.mode === "broad test reader") {
    return `${readerText(broad, readers)} read source modules at run time, outside their imports, ${like}; ${plural(edited.length, "edited module")} re-ran them`;
  }
  const own = tests.length - broad.size;
  const parts = [
    ...(own === 0 ? [] : [`${own} in their own process`]),
    ...(broad.size === 0
      ? []
      : [`${broad.size} among many source modules, ${like}: ${readerText(broad, readers)}`]),
  ];
  return `${plural(tests.length, "test file")} read ${group.gateway} at run time, outside their imports: ${parts.join("; ")}`;
}
