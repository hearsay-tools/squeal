import { describe, expect, it, onTestFinished } from "vitest";
import { crapScore, readSummary } from "../../../src/core/code/crap/index.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/index.js";
import { startDaemon } from "../../../src/core/daemon/daemon.js";
import { createFixtureRepo, SLOW, waitFor } from "../../daemon/helpers.js";
import { ON } from "../helpers.js";

/*
 * Spec 015 goal 11 (row 015-12): a daemon with coverage on judges each
 * function's `crap` and `uncovered` states once its loaders' records are
 * stored, with no edit after the runs: stored results and records nudge
 * the code pass (agreed with the coordinator).
 */

const EXTRA = `export function used(n: number): number {
  if (n > 1) return 1;
  return 0;
}

export function unused(n: number): number {
  if (n > 1) {
    if (n > 2) return 2;
    return 1;
  }
  return 0;
}
`;

const TEST = `import { expect, it } from "vitest";
import { used } from "../src/extra.ts";

it("uses one", () => {
  expect(used(5)).toBe(1);
});
`;

const policy = `${JSON.stringify({
  complexity: { enabled: true },
  coverage: { enabled: true },
  baseline: { onStart: "lookup-then-run-missing" },
})}\n`;

describe("the daemon's coverage step (015 D9)", SLOW, () => {
  it("judges crap and uncovered after the runs, from their records", async () => {
    const repo = createFixtureRepo({
      files: { "squeal.config.json": policy, "src/extra.ts": EXTRA, "test/extra.test.ts": TEST },
    });
    onTestFinished(repo.cleanup);
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(() => daemon.stop("stop-requested").then(() => {}));
    await daemon.ready;

    const states = await waitFor(
      () => {
        const store = openCodeStore(repo.commonDir, ON, { create: false });
        if (isCodeStoreOpenFailure(store)) return null;
        try {
          if (readSummary(store.meta, repo.worktreeId)?.files["src/extra.ts"]?.state !== "judged") {
            return null;
          }
          return store.states
            .list(repo.worktreeId, { paths: ["src/extra.ts"] })
            .filter((s) => s.measure !== "complexity")
            .map((s) => `${s.check.qualifiedName} ${s.measure} ${s.outcome} ${s.value ?? "-"}`);
        } finally {
          store.close();
        }
      },
      120_000,
      "src/extra.ts judged",
    );
    // `unused` is CC 3 and never ran: 3² + 3. `used` returned early: 2 of its 3 lines ran.
    expect(states).toEqual([
      "unused crap pass 12",
      "unused uncovered fail -",
      `used crap pass ${crapScore(2, 2 / 3)}`,
      "used uncovered pass -",
    ]);
  });
});
