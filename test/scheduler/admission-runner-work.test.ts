import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { statCandidates } from "../../src/core/revision/reconcile.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import { allCurrent, groupPolicy, groupSide } from "./group-lanes-fixture.js";

/*
 * Row 011-341 (research/admission.md, difference 1): a configured group
 * whose `after` names no `tests` starts no tier while runner work is
 * pending. A batch that queues runner work after the lane listed its files
 * and before its selection: the runner work is applied first, as the pump
 * applies it before a fast tier, so the tier's keys come from a revision
 * the runner has invalidated.
 *
 * The batch touches a file whose bytes end as they were (task 001-159): its
 * runner work invalidates the file and no revision preempts the lane, so
 * the order of the lock's turns alone decides what happens.
 */

const B = "test/b.test.ts";
const CORE = "src/core.ts";

/** A group of `B` at `edit`, after nothing (spec 019 D3: it starts beside fast work). */
const LATE: CheckGroup = { name: "late", runner: "vitest", tests: [B], at: "edit", after: [] };

describe("a group after no `tests` and pending runner work (row 011-341)", {
  timeout: 60_000,
}, () => {
  it("applies runner work queued after the lane's listing before the lane's tier starts", async () => {
    const { side } = await groupSide(groupPolicy({ checks: [LATE] }));
    await allCurrent(side);

    // `CORE` rewritten with its own bytes, later: a touched-unchanged path for the batch.
    const core = join(side.root, CORE);
    writeFileSync(core, readFileSync(core));
    const later = new Date(Date.now() + 5_000);
    utimesSync(core, later, later);
    const touched = await statCandidates([CORE], createFsHasher(side.root, "sha1"));

    const order: string[] = [];
    const invalidate = side.runner.invalidate;
    side.runner.invalidate = async (...args) => {
      order.push("runner work");
      return invalidate(...args);
    };
    side.runner.beforeRun = (files) => order.push(`run ${files.map((f) => f.path).join(" ")}`);

    // When the lane lists its files, a batch queues runner work behind the listing.
    let armed = false;
    let batch: Promise<void> | null = null;
    side.scheduler.watchLock?.((holder) => {
      if (!armed || holder?.operation !== "listing the queued files of group late") return;
      armed = false;
      order.push("listed");
      batch = side.scheduler.handleBatch({ trigger: "watch", paths: touched });
    });
    order.length = 0;
    armed = true;
    await side.edit("watch", "src/other.ts");
    await expect
      .poll(() => order.filter((step) => step.startsWith("run ")), {
        timeout: 20_000,
      })
      .toEqual([`run ${B}`]);
    await batch;
    await side.scheduler.idle();

    // The edit's own runner work comes before the listing; the batch's must come before the run.
    const listed = order.indexOf("listed");
    expect(listed).toBeGreaterThan(0);
    expect(order.slice(listed)).toEqual(["listed", "runner work", `run ${B}`]);
  });
});
