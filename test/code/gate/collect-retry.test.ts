import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GateRun } from "../../../src/core/code/gate/collect.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import { git } from "../../hash/git-repo.js";
import { changedSet, collect, judged, project, SLOW } from "./collect-fixture.js";

/*
 * Row 020-54 (#210): the real node:test runner, with the host's load read
 * as 48 on 24 CPUs, over the daemon's threshold. `flaky` fails its first
 * run only, as a timing test under load does; `broken` always fails;
 * `c00` passes. The two failures run once more, after the first run: flaky
 * reads passed, broken stays failed, and each names its load. The keeper
 * hears the first run only, without either failure, so no store holds a
 * result the rerun replaced.
 */

const FLAKY = "test/flaky.test.mjs";
const BROKEN = "test/broken.test.mjs";
const PASSING = "test/c00.test.mjs";

/** A test that fails until `marker` exists, which its first run writes. */
const flaky = (marker: string) => `import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { test } from "node:test";

test("passes once its first run failed", () => {
  if (existsSync(${JSON.stringify(marker)})) return;
  writeFileSync(${JSON.stringify(marker)}, "");
  assert.fail("the first run fails");
});
`;

const BROKEN_TEXT = `import assert from "node:assert/strict";
import { test } from "node:test";

test("always fails", () => assert.equal(1, 2));
`;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("collectEvidence: a node:test failure under load runs once more (row 020-54)", () => {
  it("reads the rerun's result, and keeps neither run of a retried file", SLOW, async () => {
    const root = project("early");
    const scratch = mkdtempSync(join(tmpdir(), "squeal-retry-marker-"));
    temps.push(scratch);
    writeFileSync(join(root, FLAKY), flaky(join(scratch, "ran-once")));
    writeFileSync(join(root, BROKEN), BROKEN_TEXT);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "a flaky and a broken test"]);
    const changed = await changedSet(root, [BROKEN, FLAKY, PASSING]);
    const told: GateRun[] = [];
    const { evidence } = await collect(root, changed, {
      hostLoad: () => ({ oneMinute: 48, cpus: 24 }),
      ran: async (run) => {
        told.push(run);
      },
    });

    const byPath = new Map(evidence.testFiles.map((f) => [f.path, f]));
    expect(byPath.get(FLAKY)).toMatchObject({
      completed: true,
      failed: [],
      retried: { load: 48, cpus: 24, outcome: "passed" },
    });
    expect(byPath.get(FLAKY)?.record).not.toBeNull();
    expect(byPath.get(BROKEN)).toMatchObject({
      completed: true,
      failed: ["always fails"],
      retried: { load: 48, cpus: 24, outcome: "failed" },
    });
    expect(byPath.get(PASSING)).toMatchObject({ completed: true, failed: [] });
    expect(byPath.get(PASSING)?.retried).toBeUndefined();

    // One tell, the first run's; the passing file's record is kept, the retried ones' are not.
    expect(told.map((r) => r.files.map((f) => f.path).sort())).toEqual([[BROKEN, PASSING, FLAKY]]);
    const kept = told[0]?.records;
    const id = (path: string) => testFileId({ project: "unit", path });
    expect([PASSING, BROKEN, FLAKY].map((p) => kept?.has(id(p)))).toEqual([true, false, false]);

    const { report } = await judged(root, changed, evidence);
    const runs = report.runs.filter((r) => r.runner === "node-test");
    expect(runs.map((r) => [r.runner, r.failed, r.retried])).toEqual([
      [
        "node-test",
        [{ path: BROKEN, tests: ["always fails"] }],
        {
          [BROKEN]: { load: 48, cpus: 24, outcome: "failed" },
          [FLAKY]: { load: 48, cpus: 24, outcome: "passed" },
        },
      ],
    ]);
    expect(report.verdict).toBe("incomplete");
  });
});
