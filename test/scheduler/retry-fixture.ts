import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect } from "vitest";
import { askRetry, type HostLoad, type RetryReason } from "../../src/core/retry/index.js";
import type { CheckId, Store } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, type Harness, type HarnessOptions } from "./helpers.js";

/*
 * Spec 001 D6 as amended (001-348, scope 001-368): the agent asks Squeal to
 * retry a failure caused outside its keyed inputs. `test/flaky.test.ts`
 * fails while a marker outside the worktree exists, which no key covers, as
 * a server nobody started or a timeout under load does.
 */

export const FLAKY = "test/flaky.test.ts";
export const flips: CheckId = { kind: "test", project: "", testPath: FLAKY, fullName: "flips" };
export const REF = { project: "", path: FLAKY };

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

export function flakyRepo() {
  const repo = createRepo();
  const marker = join(tmpdir(), `squeal-001-368-${randomUUID()}`);
  markers.push(marker);
  writeFileSync(
    join(repo.main, FLAKY),
    [
      'import { existsSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      "",
      `it("flips", () => expect(existsSync(${JSON.stringify(marker)})).toBe(false));`,
      "",
    ].join("\n"),
  );
  git(repo.main, ["add", FLAKY]);
  git(repo.main, ["commit", "-qm", "flaky"]);
  writeFileSync(marker, "");
  return { ...repo, marker };
}

/** A host load the test sets; 16 on 8 CPUs until it says otherwise. */
export function loadKnob() {
  let load: HostLoad = { oneMinute: 16, cpus: 8 };
  return {
    read: () => load,
    set: (oneMinute: number) => {
      load = { oneMinute, cpus: 8 };
    },
  };
}

/** No 001-171 re-run: the failure stands after its first run, as one caused outside the code. */
export const options = (load: ReturnType<typeof loadKnob>): HarnessOptions => ({
  policy: RUN_MISSING,
  rerunCap: 0,
  hostLoad: load.read,
});

export async function failing(h: Harness) {
  await h.scheduler.start();
  await h.scheduler.idle();
  expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
  return h.keyOf(FLAKY) as string;
}

export function ask(store: Store, h: Harness, session: string, reason: RetryReason) {
  return askRetry(store, {
    testFile: REF,
    key: h.keyOf(FLAKY) as string,
    session,
    reason,
    at: Date.now(),
    worktreeId: h.worktreeId,
  });
}

/** A reconciliation pass, as the change feed's every 30 s, and its work. */
export async function pass(h: Harness) {
  await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
  await h.scheduler.idle();
}
