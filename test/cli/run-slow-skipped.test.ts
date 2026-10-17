import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DaemonSync } from "../../src/cli/status-sync.js";
import { slowWaitCode, waitForStatus } from "../../src/cli/status-wait.js";
import { type EndedWait, waitLine } from "../../src/cli/status-wait-lines.js";
import { publishSlowSkips } from "../../src/core/state/index.js";
import { check, state } from "../status/helpers.js";
import {
  answering,
  finish,
  key,
  later,
  NOW,
  options,
  repoWith,
  SLOW_FILE,
} from "./status-wait-fixture.js";

/*
 * Spec 004 D8 as amended 2026-10-17 (task 004-65, issues #3 and #16):
 * `squeal run --slow --wait` gives no verdict for a slow tier its
 * precondition skipped. It prints the reason and exits 3, never 0, though
 * nothing is left pending once the skip took the files out of the queue.
 */

const REASON = "dist/index.js matches no file (slow.precondition.exists)";

/** `sync`, and `fn` `ms` after the wait asked for it, which it does at its first read. */
function onFirstRead(sync: () => DaemonSync, ms: number, fn: () => void): () => DaemonSync {
  return () => {
    later(ms, fn);
    return sync();
  };
}

describe("run --slow --wait on a skipped slow tier (004 D8 as amended 2026-10-17)", {
  timeout: 30_000,
}, () => {
  it("ends with the reason and no verdict, exit 3, once the skip leaves nothing pending", async () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    writeFileSync(
      join(repo.main, "squeal.config.json"),
      JSON.stringify({ slow: { include: [SLOW_FILE] } }),
    );
    const sync = onFirstRead(answering(store, repo.mainId, []).sync, 100, () => {
      // The slow tier found the precondition unmet: the file left the queue with no result.
      key(store, repo.mainId, SLOW_FILE, null);
      const holds = check(SLOW_FILE, "holds");
      store.knownStates.upsertMany([
        state(repo.mainId, holds, { validity: "stale", observedAt: 3 }),
      ]);
      publishSlowSkips(store, repo.mainId, [
        {
          precondition: { exists: ["dist/index.js"] },
          source: "slow.precondition",
          reason: REASON,
          since: NOW,
          testFiles: [{ project: "", path: SLOW_FILE }],
        },
      ]);
    });

    const wait = await waitForStatus(repo.main, { ...options(sync, 5_000), holdSlow: true });

    expect(wait.outcome).toBe("quiet");
    const ended = wait as EndedWait;
    expect(slowWaitCode(ended)).toBe(3);
    expect(waitLine(ended)).toContain(
      `; the slow tier has no verdict: it was skipped, ${REASON}, and runs once the precondition holds`,
    );
  });

  it("keeps exit 0 when the held slow files have their results", async () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    writeFileSync(
      join(repo.main, "squeal.config.json"),
      JSON.stringify({ slow: { include: [SLOW_FILE] } }),
    );
    const sync = onFirstRead(answering(store, repo.mainId, []).sync, 100, () =>
      finish(store, repo.mainId, SLOW_FILE),
    );
    const wait = await waitForStatus(repo.main, { ...options(sync, 5_000), holdSlow: true });
    expect(slowWaitCode(wait as EndedWait)).toBe(0);
    expect(waitLine(wait as EndedWait)).not.toContain("skipped");
  });
});
