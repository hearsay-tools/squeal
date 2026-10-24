import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeStatusOf, coverageStatusLines } from "../../../src/core/status/code-status.js";
import type { StatusSnapshot } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, coverageRig, sourceOf } from "./rig.js";

/*
 * Spec 015 D9 (row 015-12): status's coverage line and `code.coverage`,
 * read from the store with no daemon: which files wait, for test runs or
 * records, which read unknown and why, and the test files not read.
 */

function policy(rig: CoverageRig, over: Record<string, unknown>) {
  writeFileSync(
    join(rig.tree.root, "squeal.config.json"),
    JSON.stringify({ complexity: { enabled: true }, ...over }),
  );
}

const statusOf = (rig: CoverageRig) =>
  codeStatusOf(rig.main, WT, { root: rig.tree.root, commonDir: () => rig.tree.commonDir }, null);

const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";

describe("status with coverage on", () => {
  it("counts the failing functions and says which files wait and why others are unknown", async () => {
    const rig = coverageRig();
    policy(rig, { coverage: { enabled: true }, vitest: { exclude: ["test/e2e/**"] } });
    await rig.edit({
      "src/a.ts": "hot 12 h1\ncold 6 c1\n",
      "src/b.ts": "b 1 b1\n",
      "src/c.ts": "c 1 c1\n",
      "src/d.ts": "d 1 d1\n",
    });
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      record: [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 2, [1])],
    });
    rig.loader("test/b.test.ts", { closure: ["src/b.ts"], pending: "queued" });
    rig.loader("test/c.test.ts", { closure: ["src/c.ts"], outcomes: ["skip"] });
    rig.loader("test/d.test.ts", { closure: ["src/d.ts"], recordedAt: rig.clock });
    rig.step();

    const { code } = statusOf(rig);
    expect(code?.coverage).toEqual({
      v: 1,
      threshold: 30,
      crap: 1,
      uncovered: 1,
      files: 4,
      waitingForRuns: 1,
      waitingForRecords: 1,
      unknown: { skipped: 1 },
      notRead: ["test/e2e/**"],
    });
    expect(coverageStatusLines({ code } as StatusSnapshot, "squeal")).toEqual([
      "Coverage: 1 function over CRAP 30, 1 that no in-process test that Squeal runs reaches; 1 file waits for test runs, which squeal run --all makes; 1 file waits for coverage records; 1 file unknown (1 from a skipped test); test files Squeal does not run are not read (test/e2e/**); squeal code lists them.",
    ]);
  });

  it("has no coverage part while coverage is off", async () => {
    const rig = coverageRig();
    policy(rig, {});
    await rig.edit({ "src/a.ts": "hot 12 h1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [] });
    rig.step();
    const { code } = statusOf(rig);
    expect(code).toBeDefined();
    expect(code && "coverage" in code).toBe(false);
    expect(coverageStatusLines({ code } as StatusSnapshot, "squeal")).toEqual([]);
  });
});
