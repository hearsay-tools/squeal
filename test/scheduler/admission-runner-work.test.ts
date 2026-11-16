import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { statCandidates } from "../../src/core/revision/reconcile.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import { allCurrent, groupPolicy, groupSide } from "./group-lanes-fixture.js";

/*
 * Row 011-341 (research/admission.md, difference 1): a configured group
 * whose `after` names no `tests` starts no tier while runner work is
 * pending. Row 011-357: the lane lists, guards and picks inside the step's
 * one lock turn, so no batch lands between its listing and its pick. A
 * batch whose runner work is queued before the step in which the lane
 * would start its tier (here while the step before it reads the probe) is
 * applied first, as the pump applies it before a fast tier, so the tier's
 * keys come from a revision the runner has invalidated.
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
  it("applies runner work queued before the step in which the lane would start its tier first", async () => {
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
      const done = await invalidate(...args);
      // The batch's runner work takes a while: a tier that started before it ended would show.
      if (order.includes("staged")) {
        await delay(100);
        order.push("runner work applied");
      }
      return done;
    };
    side.runner.beforeRun = (files) => order.push(`run ${files.map((f) => f.path).join(" ")}`);
    // Row 011-357: the step's turn names the lane's part while it is in it.
    const texts: string[] = [];
    const unwatch = side.scheduler.watchLock?.((holder) => {
      if (holder?.operation?.endsWith("group late") === true) texts.push(holder.operation);
    });

    // The step that reads the probe for the lane's step: a batch queues runner work behind it.
    let armed = false;
    let batch: Promise<void> | null = null;
    const unstep = side.scheduler.onStep?.((seen) => {
      if (!armed || !seen.decisions.includes("read-probe")) return;
      armed = false;
      order.push("staged");
      batch = side.scheduler.handleBatch({ trigger: "watch", paths: touched });
    });
    try {
      order.length = 0;
      armed = true;
      await side.edit("watch", "src/other.ts");
      await expect
        .poll(() => order.filter((step) => step.startsWith("run ")), {
          timeout: 20_000,
        })
        .toEqual([`run ${B}`]);
      await batch;
      await side.rest();
    } finally {
      unwatch?.();
      unstep?.();
    }

    // The edit's own runner work comes before the staging; the batch's must come before the run.
    const staged = order.indexOf("staged");
    expect(staged).toBeGreaterThan(0);
    expect(order.slice(staged)).toEqual([
      "staged",
      "runner work",
      "runner work applied",
      `run ${B}`,
    ]);
    expect(texts.slice(0, 2)).toEqual([
      "listing the queued files of group late",
      "selecting a tier of group late",
    ]);
  });
});
