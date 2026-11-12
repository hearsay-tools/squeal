import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import {
  type AffectedAsk,
  affectedAsk,
  type GraphSource,
  graphAffected,
  type WalkEntry,
} from "../../src/core/scheduler/stored-affected.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import type { FileChange } from "../../src/core/types/revision.js";

/*
 * Row 021-30 (spec 021 D21.3): `affected` from the stored import graph, and
 * every way the rule hands the call back to the host. A small graph:
 *
 *   test/direct.test.ts  -> src/leaf.ts
 *   test/through.test.ts -> src/mid.ts -> src/leaf.ts
 *   test/other.test.ts   -> src/other.ts
 *   test/declared.test.ts names src/leaf.ts in its closure (a declared
 *   input), but its walk does not visit it.
 */

const DIRECT = "test/direct.test.ts";
const THROUGH = "test/through.test.ts";
const OTHER = "test/other.test.ts";
const DECLARED = "test/declared.test.ts";
const LEAF = "src/leaf.ts";
const MID = "src/mid.ts";

const ref = (path: string, project = ""): TestFileRef => ({ project, path }) as TestFileRef;
const key = (name: string) => name as CheckKey;

interface Fake {
  /** Closure paths by test file, the file itself included. */
  closures: Record<string, string[]>;
  /** Stored walks by test file and key. */
  walks: Record<string, Record<string, WalkEntry[]>>;
  /** Current keys; absent is `key-<path>`. */
  keys?: Record<string, CheckKey | null>;
  runners?: Record<string, string>;
  environment?: string[];
  /** Test files listed without a closure. */
  bare?: string[];
  /** Projects by test file; absent is `""`. */
  projects?: Record<string, string>;
}

function fake(): Fake {
  const entry = (path: string, ...targets: string[]) =>
    [path as RelativePath, targets as RelativePath[], [] as RelativePath[]] as const;
  return {
    closures: {
      [DIRECT]: [DIRECT, LEAF],
      [THROUGH]: [THROUGH, MID, LEAF],
      [OTHER]: [OTHER, "src/other.ts"],
      [DECLARED]: [DECLARED, LEAF],
    },
    walks: {
      [DIRECT]: { [`key-${DIRECT}`]: [entry(DIRECT, LEAF), entry(LEAF)] },
      [THROUGH]: {
        [`key-${THROUGH}`]: [entry(THROUGH, MID), entry(MID, LEAF), entry(LEAF)],
      },
      [OTHER]: { [`key-${OTHER}`]: [entry(OTHER, "src/other.ts"), entry("src/other.ts")] },
      [DECLARED]: { [`key-${DECLARED}`]: [entry(DECLARED)] },
    },
  };
}

function sourceOf(f: Fake): GraphSource {
  const refs = [...Object.keys(f.closures), ...(f.bare ?? [])].map((path) =>
    ref(path, f.projects?.[path]),
  );
  return {
    testFiles: refs,
    referencing: (paths) =>
      refs.filter((r) => (f.closures[r.path] ?? []).some((p) => paths.includes(p as RelativePath))),
    hasClosure: (r) => f.closures[r.path] !== undefined,
    runnerOf: (project) => f.runners?.[project] ?? "vitest",
    isEnvironmentInput: (path) => (f.environment ?? []).includes(path),
    key: (r) =>
      f.keys !== undefined && r.path in f.keys ? (f.keys[r.path] ?? null) : key(`key-${r.path}`),
    walk: (r, k) => f.walks[r.path]?.[k],
  };
}

const change = (path: string, kind: "change" | "add" | "delete" = "change"): FileChange =>
  ({
    path,
    oldHash: kind === "add" ? null : "old",
    newHash: kind === "delete" ? null : "new",
  }) as unknown as FileChange;

function ask(paths: string[], extra: Partial<AffectedAsk> = {}): AffectedAsk {
  return { changes: paths.map((p) => change(p)), runnerMoved: false, ...extra };
}

const answer = (f: Fake, a: AffectedAsk, paths = a.changes.map((c) => c.path)) => {
  const got = graphAffected(sourceOf(f), a, paths);
  return got === null
    ? null
    : { direct: got.direct.map((r) => r.path), transitive: got.transitive.map((r) => r.path) };
};

describe("the stored graph's affected (021-30)", () => {
  it("splits direct importers from files that reach a change through others, as Vitest's walk", () => {
    expect(answer(fake(), ask([LEAF]))).toEqual({ direct: [DIRECT], transitive: [THROUGH] });
    expect(answer(fake(), ask([MID]))).toEqual({ direct: [THROUGH], transitive: [] });
  });

  it("leaves out a file whose closure names the path but whose walk does not visit it", () => {
    const got = answer(fake(), ask([LEAF]));
    expect(got?.direct).not.toContain(DECLARED);
    expect(got?.transitive).not.toContain(DECLARED);
  });

  it("counts a changed test file as its own direct file, with no walk of it needed", () => {
    const f = fake();
    delete f.walks[DIRECT];
    expect(answer(f, ask([DIRECT]))).toEqual({ direct: [DIRECT], transitive: [] });
  });

  it("answers for several paths together, and for the edit cut's part of them", () => {
    const both = ask([MID, "src/other.ts"]);
    expect(answer(fake(), both)).toEqual({ direct: [OTHER, THROUGH], transitive: [] });
    expect(answer(fake(), both, ["src/other.ts" as RelativePath])).toEqual({
      direct: [OTHER],
      transitive: [],
    });
  });

  it("reads each walk at the key the file held before the revision", () => {
    const f = fake();
    // The content re-key moved both keys; only the earlier ones have walks.
    f.keys = { [DIRECT]: key("new-direct"), [THROUGH]: key("new-through") };
    const previous = new Map([
      [testFileId(ref(DIRECT)), key(`key-${DIRECT}`)],
      [testFileId(ref(THROUGH)), key(`key-${THROUGH}`)],
    ]);
    expect(answer(f, ask([LEAF], { previous }))).toEqual({
      direct: [DIRECT],
      transitive: [THROUGH],
    });
    expect(answer(f, ask([LEAF]))).toBeNull();
  });

  it("ignores a file the reverse index names that is not listed", () => {
    const f = fake();
    const source = sourceOf(f);
    const got = graphAffected(
      { ...source, testFiles: source.testFiles.filter((r) => r.path !== THROUGH) },
      ask([LEAF]),
      [LEAF as RelativePath],
    );
    expect(got?.transitive).toEqual([]);
  });

  describe("hands the call to the host", () => {
    const cases: [string, (f: Fake) => AffectedAsk][] = [
      ["an add", () => ({ changes: [change("src/new.ts", "add")], runnerMoved: false })],
      ["a delete", () => ({ changes: [change(LEAF, "delete")], runnerMoved: false })],
      ["a snapshot", () => ask(["test/__snapshots__/direct.test.ts.snap"])],
      [
        "an environment input",
        (f) => {
          f.environment = ["vitest.config.ts"];
          return ask([LEAF, "vitest.config.ts"]);
        },
      ],
      ["a recreated project or a re-read listing", () => ask([LEAF], { runnerMoved: true })],
      [
        "a node:test project among the listed files",
        (f) => {
          f.closures["nt/test/a.test.mjs"] = ["nt/test/a.test.mjs"];
          f.projects = { "nt/test/a.test.mjs": "nt" };
          f.runners = { nt: "node-test" };
          return ask([LEAF]);
        },
      ],
      [
        "a listed file without a closure",
        (f) => {
          f.bare = ["test/unresolved.test.ts"];
          return ask([LEAF]);
        },
      ],
      [
        "an affected file with no walk at its earlier key",
        (f) => {
          delete f.walks[THROUGH];
          return ask([LEAF]);
        },
      ],
      [
        "a walk without its test file's own entry",
        (f) => {
          f.walks[DIRECT] = { [`key-${DIRECT}`]: [[LEAF as RelativePath, [], []]] };
          return ask([LEAF]);
        },
      ],
      [
        "an affected file with no key",
        (f) => {
          f.keys = { [THROUGH]: null };
          return ask([LEAF]);
        },
      ],
    ];
    for (const [name, make] of cases) {
      it(`for ${name}`, () => {
        const f = fake();
        expect(answer(f, make(f))).toBeNull();
      });
    }
  });

  it("reads rule 2 from what the runner part saw", () => {
    const none = {
      recreated: new Set<never>(),
      retrying: false,
      listed: undefined,
      failures: new Map(),
    };
    const content = { environment: false };
    expect(affectedAsk([], content, none).runnerMoved).toBe(false);
    for (const seen of [
      { ...none, recreated: new Set([""]) },
      { ...none, retrying: true },
      { ...none, listed: [] },
      { ...none, listed: null },
      { ...none, failures: new Map([[null, "boom"]]) },
    ]) {
      expect(affectedAsk([], content, seen as never).runnerMoved).toBe(true);
    }
    expect(affectedAsk([], { environment: true }, none).runnerMoved).toBe(true);
  });
});
