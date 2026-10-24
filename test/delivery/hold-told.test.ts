import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDelivery, formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import type { Consumer } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  A,
  B,
  batch,
  FILES,
  gitMay,
  HELPER,
  heldPaths,
  helperReturning,
  holdSide,
  mergeRepo,
  OTHER,
  outcomes,
  runsOf,
} from "../scheduler/merge-hold-fixture.js";
import { fixedStatus } from "./fakes.js";

/*
 * Row 011-73 (011 C8 as amended 2026-10-21; `tasks/011-61/design.md` R2,
 * test 3): a hold's start and end are told as liveness is. The boundary
 * after the hold starts delivers one line and no FAIL, the next delivers
 * nothing, the end delivers one `validating again` line, and files that
 * passed before and after deliver nothing. A real scheduler holds.
 */

const ON_HOLD =
  /^SQUEAL · validation on hold at revision \d+: git lists 1 unmerged path \(src\/helper\.ts\)\. No test runs until git lists none: resolve it and `git add` it, or abort\.$/;

async function registered() {
  const repo = mergeRepo();
  const side = holdSide(repo, repo.main, FILES, RUN_MISSING);
  await side.scheduler.start();
  await side.scheduler.idle();
  const delivery = createDelivery(side.store, { status: fixedStatus() });
  const consumer: Consumer = { worktreeId: side.worktreeId, sessionId: "s1", agentId: "main" };
  await delivery.register(consumer);
  expect(await delivery.onToolBoundary(consumer)).toBeNull();
  return { repo, side, delivery, consumer };
}

describe("delivery: a hold's start and end (row 011-73)", { timeout: 60_000 }, () => {
  it("3: one line at the start and no FAIL, nothing next, one `validating again` line at the end", async () => {
    const { repo, side, delivery, consumer } = await registered();
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    await side.scheduler.idle();
    expect(heldPaths(side)).toEqual([HELPER]);

    const start = await delivery.onToolBoundary(consumer);
    expect(start?.holds).toMatchObject([{ kind: "on-hold", hold: { cause: "merge" } }]);
    expect(start?.entries).toEqual([]);
    const text = formatDelta(start ?? never());
    expect(text.split("\n")[0]).toMatch(ON_HOLD);
    expect(text).not.toContain("FAIL");
    expect(text.match(/on hold/g)).toHaveLength(1);

    expect(await delivery.onToolBoundary(consumer)).toBeNull();

    // The resolved write holds too; `git add` ends the hold, and both importers pass again.
    writeFileSync(join(repo.main, HELPER), helperReturning(4));
    await batch(side, HELPER);
    await side.scheduler.idle();
    expect(await delivery.onToolBoundary(consumer)).toBeNull();
    git(repo.main, ["add", HELPER]);
    await expect
      .poll(() => [runsOf(side, A), runsOf(side, B)], { timeout: 10_000 })
      .toEqual([2, 2]);
    await side.scheduler.idle();
    expect(outcomes(side, A)).toEqual(["pass"]);

    const end = await delivery.onToolBoundary(consumer);
    expect(end?.entries).toEqual([]);
    expect(end?.holds).toMatchObject([{ kind: "resumed", ended: { cause: "merge" } }]);
    expect(formatDelta(end ?? never()).split("\n")[0]).toMatch(
      /^SQUEAL · validating again at revision \d+: git lists no unmerged path; 0 test files queued\.$/,
    );
    expect(await delivery.onToolBoundary(consumer)).toBeNull();
    expect(runsOf(side, OTHER)).toBe(1);
  });

  it("3: a registration while on hold carries the status line, and its next boundary says nothing", async () => {
    const repo = mergeRepo();
    const side = holdSide(repo);
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    await side.scheduler.idle();
    const delivery = createDelivery(side.store, { status: fixedStatus() });
    const consumer: Consumer = { worktreeId: side.worktreeId, sessionId: "s2", agentId: "main" };
    const registration = await delivery.register(consumer);
    expect(formatRegistration(registration)).toMatch(
      / On hold: unresolved merge since \d\d:\d\d:\d\d, git lists 1 unmerged path \(src\/helper\.ts\); no test runs until git lists none\./,
    );
    expect(await delivery.onToolBoundary(consumer)).toBeNull();
  });
});

function never(): never {
  throw new Error("no delivery");
}
