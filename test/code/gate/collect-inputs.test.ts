import { describe, expect, it } from "vitest";
import { type CollectOptions, collectEvidence } from "../../../src/core/code/gate/collect.js";
import type { SelectionSummary } from "../../../src/core/code/gate/prerun.js";
import type { GateAdapters } from "../../../src/core/code/gate/runners.js";
import { type GateScope, resolveScope } from "../../../src/core/code/gate/scope.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { PolicyInputs } from "../../../src/core/types/policy.js";
import type { RunnerAdapter, RunReport } from "../../../src/core/types/runner.js";
import { changedSet, NO_ADAPTERS, project, scopeOf } from "./collect-fixture.js";

/*
 * Spec 020 D3.1 as amended 2026-11-12 (row 020-35, #194): the gate also
 * selects every test file whose declared `inputs` at the base name a
 * changed path, by the daemon's rules: a map per test glob, a list for
 * every test file. Row 020-34 (D14.4): with `coverage.children`, a path no
 * selected closure loads is told `unloaded` when no selected file runs or
 * is read, and `childMayLoad` when some does. Fake adapters on the
 * `selection` fixture; `src/orphan.ts` is a script no test imports.
 */

const UNIT: TestFileRef = { project: "", path: "test/unit/a.test.ts" };
const RELEASE: TestFileRef = { project: "", path: "test/e2e/release.test.ts" };
const OTHER: TestFileRef = { project: "", path: "test/e2e/other.test.ts" };

/** Each test file's static closure: only `UNIT` imports a source, `src/changed.ts`. */
const CLOSURES: Readonly<Record<string, readonly string[]>> = {
  [UNIT.path]: [UNIT.path, "src/changed.ts"],
  [RELEASE.path]: [RELEASE.path],
  [OTHER.path]: [OTHER.path],
};

const EMPTY_REPORT = {
  end: "completed",
  completedFiles: [],
  results: [],
  fileErrors: [],
} as unknown as RunReport;

/** An adapter listing `listed`, whose `affected()` follows `CLOSURES`, and that records each run's files. */
function fake(ran: string[], listed: readonly TestFileRef[] = [UNIT, RELEASE, OTHER]) {
  const closureOf = (ref: TestFileRef) => CLOSURES[ref.path] ?? [ref.path];
  const adapter: Partial<RunnerAdapter> = {
    testFiles: async () => listed,
    affected: async (paths) => ({
      direct: listed.filter((ref) => closureOf(ref).some((p) => paths.includes(p))),
      transitive: [],
    }),
    closure: async (ref) =>
      ({ testFile: ref, paths: [...closureOf(ref)] }) as Awaited<
        ReturnType<RunnerAdapter["closure"]>
      >,
    run: async (files) => {
      ran.push(...files.map((f) => f.path));
      return EMPTY_REPORT;
    },
    close: async () => {},
  };
  return adapter as RunnerAdapter;
}

interface Told {
  readonly summary: SelectionSummary | null;
  readonly ran: readonly string[];
}

async function told(
  paths: readonly string[],
  options: Partial<CollectOptions> & { readonly inputs?: PolicyInputs } = {},
  scoped?: (root: string) => GateScope,
): Promise<Told> {
  const root = project("selection");
  const ran: string[] = [];
  const adapters: GateAdapters = { ...NO_ADAPTERS, vitest: async () => fake(ran) };
  const fallback = resolveScope(undefined, []);
  if ("error" in fallback) throw new Error(fallback.error);
  let summary: SelectionSummary | null = null;
  await collectEvidence(root, await changedSet(root, paths), {
    tests: [],
    budgetSeconds: 600,
    adapters,
    scope: scoped?.(root) ?? fallback,
    selected: (s) => {
      summary = s;
    },
    ...options,
  });
  return { summary, ran: [...ran].sort() };
}

const MAP: PolicyInputs = { "test/e2e/release.test.ts": ["src/orphan.ts"] };

describe("collectEvidence: selection by declared inputs at the base (spec 020 D3.1, row 020-35)", () => {
  it("selects the test files a map entry gives a changed path, and names them apart", async () => {
    const { summary, ran } = await told(["src/orphan.ts"], { inputs: MAP });

    expect(ran).toEqual([RELEASE.path]);
    expect(summary?.runners).toEqual([
      {
        runner: "vitest",
        files: 1,
        run: 1,
        known: { store: 0, parts: 0 },
        groups: [{ name: "tests", files: 1 }],
        byInputs: [RELEASE.path],
      },
    ]);
    // No closure holds the path, and children are off: it stays unloaded.
    expect(summary?.unloaded).toEqual(["src/orphan.ts"]);
  });

  it("gives every test file a list form's globs, as the daemon keys them", async () => {
    const { summary, ran } = await told(["src/orphan.ts"], { inputs: ["src/orphan.*"] });

    expect(ran).toEqual([RELEASE.path, OTHER.path, UNIT.path].sort());
    expect(summary?.runners[0]?.byInputs).toEqual([OTHER.path, RELEASE.path, UNIT.path]);
  });

  it("does not name a file its imports chose too, and adds none for a path no glob matches", async () => {
    const both = await told(["src/changed.ts"], { inputs: ["src/changed.ts"] });
    const unmatched = await told(["src/changed.ts"], { inputs: MAP });

    // The list form selects every file; UNIT imports the path, so only the others are named.
    expect(both.ran).toEqual([RELEASE.path, OTHER.path, UNIT.path].sort());
    expect(both.summary?.runners[0]?.byInputs).toEqual([OTHER.path, RELEASE.path]);
    expect(unmatched.ran).toEqual([UNIT.path]);
    expect(unmatched.summary?.runners[0]).not.toHaveProperty("byInputs");
  });

  it("selects nothing by inputs without a declaration, or a map entry for another test glob", async () => {
    const none = await told(["src/orphan.ts"]);
    const elsewhere = await told(["src/orphan.ts"], {
      inputs: { "test/unit/*.test.ts": ["src/other.ts"], "test/nothing/*": ["src/**"] },
    });

    for (const { summary, ran } of [none, elsewhere]) {
      expect(ran).toEqual([]);
      expect(summary?.runners[0]).toMatchObject({ files: 0 });
      expect(summary?.runners[0]).not.toHaveProperty("byInputs");
    }
  });

  it("keeps the scope: a file inputs chose in a left-out group neither runs nor is named", async () => {
    const checks = [
      { name: "e2e", runner: "vitest" as const, include: ["test/e2e/**"], at: "manual" as const },
    ];
    const { summary, ran } = await told(["src/orphan.ts"], { inputs: MAP }, (root) =>
      scopeOf(root, [], checks),
    );

    expect(ran).toEqual([]);
    expect(summary?.runners[0]).toMatchObject({ files: 0, run: 0 });
    expect(summary?.runners[0]).not.toHaveProperty("byInputs");
  });
});

describe("collectEvidence: the unloaded paths with coverage.children (spec 020 D14.4, row 020-34)", () => {
  it("keeps a path unloaded when no selected file runs or is read: nothing can measure it", async () => {
    const { summary, ran } = await told(["src/orphan.ts"], { children: true });

    expect(ran).toEqual([]);
    expect(summary?.unloaded).toEqual(["src/orphan.ts"]);
    expect(summary).not.toHaveProperty("childMayLoad");
  });

  it("tells it as one a child process may load while some selected file runs", async () => {
    const { summary, ran } = await told(["src/changed.ts", "src/orphan.ts"], { children: true });

    expect(ran).toEqual([UNIT.path]);
    expect(summary?.unloaded).toEqual([]);
    expect(summary?.childMayLoad).toEqual(["src/orphan.ts"]);
  });

  it("tells a path a declared test starts as one a child may load, with the test named apart", async () => {
    const { summary } = await told(["src/orphan.ts"], { children: true, inputs: MAP });

    expect(summary?.runners[0]?.byInputs).toEqual([RELEASE.path]);
    expect(summary?.unloaded).toEqual([]);
    expect(summary?.childMayLoad).toEqual(["src/orphan.ts"]);
  });

  it("tells neither when every changed path is loaded", async () => {
    const { summary } = await told(["src/changed.ts"], { children: true });

    expect(summary?.unloaded).toEqual([]);
    expect(summary).not.toHaveProperty("childMayLoad");
  });
});
