import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readScope, resolveScope } from "../../../src/core/code/gate/scope.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { changedSet, collect, judged, project, SLOW } from "./collect-fixture.js";

/*
 * Spec 026 D5.2 (rows 026-08, 026-21): `--narrow` on the D14 fixture.
 * `src/store.ts` changes; `test/store.test.ts` is its namesake, and
 * `e2e/page.test.ts` loads it through a helper only. The narrow set is
 * what `squeal run <group> --base` keeps per group: the namesake, and in
 * the browser group the `runner.tierSize` shortest readers. With a second
 * reader and `tierSize` 1, the spec past it is left out with its closure
 * read, so `store.ts` stays incomplete. A stored failure of the left-out
 * spec is named, never run.
 */

/** The fixture's scope with `--group` names `added` and `--narrow`. */
function narrowScope(root: string, added: readonly string[] = []) {
  const scope = resolveScope(readScope(loadPolicy(root).policy).base, added, true);
  if ("error" in scope) throw new Error(scope.error);
  return scope;
}

/** A second browser reader of `src/store.ts`, and `runner.tierSize` 1: one reader per group runs. */
function secondReader(root: string): void {
  const config = {
    checks: [{ name: "browser", runner: "vitest", project: "browser", at: "manual" }],
  };
  writeFileSync(
    join(root, "squeal.config.json"),
    JSON.stringify({ ...config, runner: { tierSize: 1 } }),
  );
  writeFileSync(
    join(root, "e2e/other.test.ts"),
    'import { expect, it } from "vitest";\nimport { seeded } from "./helper";\n\nit("seeds", () => {\n  expect(seeded()).toBe(42);\n});\n',
  );
}

const ran = (files: readonly { path: string }[]) => files.map((f) => f.path);

describe("collectEvidence with --narrow (spec 026 D5.2)", () => {
  it(
    "runs the namesake and the shortest reader, and leaves the reader past tierSize out, its closure read",
    SLOW,
    async () => {
      const root = project("scope");
      secondReader(root);
      const changed = await changedSet(root, ["src/store.ts"]);
      const failing = { failed: ["page renders"] } as unknown as TestFileEvidence;
      const { evidence } = await collect(root, changed, {
        scope: narrowScope(root),
        narrow: true,
        leftOutStored: async (_runner, files) =>
          new Map(files.filter((f) => f.path === "e2e/page.test.ts").map((f) => [f, failing])),
      });
      expect(ran(evidence.testFiles)).toEqual(["e2e/other.test.ts", "test/store.test.ts"]);
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

  it("with --group browser --narrow runs the reader run browser --base keeps", SLOW, async () => {
    const root = project("scope");
    const changed = await changedSet(root, ["src/store.ts"]);
    const { evidence } = await collect(root, changed, {
      scope: narrowScope(root, ["browser"]),
      narrow: true,
    });
    expect(ran(evidence.testFiles)).toEqual(["e2e/page.test.ts"]);
    expect(evidence.scope?.inScope.map((g) => g.name)).toEqual(["browser"]);
    expect((evidence.scope?.files ?? []).map((f) => [f.path, f.group])).toEqual([
      ["test/store.test.ts", "tests"],
    ]);
    expect(evidence.scope?.narrowed ?? 0).toBe(0);
  });
});
