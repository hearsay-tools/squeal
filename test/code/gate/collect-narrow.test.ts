import { describe, expect, it } from "vitest";
import { readScope, resolveScope } from "../../../src/core/code/gate/scope.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { changedSet, collect, judged, project, SLOW } from "./collect-fixture.js";

/*
 * Spec 026 D5.2 (row 026-08): `--narrow` on the D14 fixture. `src/store.ts`
 * changes; `test/store.test.ts` is its namesake, and `e2e/page.test.ts`
 * loads it through a helper only. The narrow set is the namesake; the spec
 * is left out with its closure read, so `store.ts` stays incomplete. A
 * stored failure of the left-out spec is named, never run.
 */

/** The fixture's scope with `--group` names `added` and `--narrow`. */
function narrowScope(root: string, added: readonly string[] = []) {
  const scope = resolveScope(readScope(loadPolicy(root).policy).base, added, true);
  if ("error" in scope) throw new Error(scope.error);
  return scope;
}

const ran = (files: readonly { path: string }[]) => files.map((f) => f.path);

describe("collectEvidence with --narrow (spec 026 D5.2)", () => {
  it(
    "runs only the namesake and leaves the transitive loader out, its closure read",
    SLOW,
    async () => {
      const root = project("scope");
      const changed = await changedSet(root, ["src/store.ts"]);
      const failing = { failed: ["page renders"] } as unknown as TestFileEvidence;
      const { evidence } = await collect(root, changed, {
        scope: narrowScope(root),
        narrow: true,
        leftOutStored: async (_runner, files) =>
          new Map(files.filter((f) => f.path === "e2e/page.test.ts").map((f) => [f, failing])),
      });
      expect(ran(evidence.testFiles)).toEqual(["test/store.test.ts"]);
      expect(evidence.scope?.inScope.map((g) => [g.name, g.from])).toEqual([
        ["browser", "--narrow"],
        ["tests", "--narrow"],
        ["slow", "--narrow"],
      ]);
      expect(evidence.scope?.narrowed).toBe(1);
      const [file] = evidence.scope?.files ?? [];
      expect(file).toMatchObject({ path: "e2e/page.test.ts", group: "browser" });
      expect(file?.loads).toEqual(expect.arrayContaining(["src/store.ts"]));
      expect(evidence.scope?.failures).toEqual([
        { runner: "vitest", path: "e2e/page.test.ts", group: "browser", tests: ["page renders"] },
      ]);
      const { report } = await judged(root, changed, evidence);
      expect(report.verdict).not.toBe("pass");
      expect(report.functions.every((f) => f.loaders.leftOut?.includes("e2e/page.test.ts"))).toBe(
        true,
      );
      expect(report.scope?.leftOutFailures).toHaveLength(1);
    },
  );

  it("with --group browser --narrow runs nothing, and leaves both files out", SLOW, async () => {
    const root = project("scope");
    const changed = await changedSet(root, ["src/store.ts"]);
    const { evidence } = await collect(root, changed, {
      scope: narrowScope(root, ["browser"]),
      narrow: true,
    });
    expect(ran(evidence.testFiles)).toEqual([]);
    expect(evidence.scope?.inScope.map((g) => g.name)).toEqual(["browser"]);
    expect((evidence.scope?.files ?? []).map((f) => [f.path, f.group])).toEqual([
      ["e2e/page.test.ts", "browser"],
      ["test/store.test.ts", "tests"],
    ]);
    expect(evidence.scope?.narrowed).toBe(1);
  });
});
