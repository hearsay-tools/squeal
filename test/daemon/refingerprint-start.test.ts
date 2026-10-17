import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { FINGERPRINT_RULES } from "../../src/core/state/fingerprint.js";
import {
  isStoreOpenFailure,
  META_FINGERPRINT_RULES,
  openStore,
} from "../../src/core/store/index.js";
import type { KnownState, TestCheckId } from "../../src/core/types/index.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Task 011-14: a daemon's first start under new fingerprint rules rewrites
 * the fingerprints stored under the previous ones, in the transaction that
 * registers it, before any state is derived.
 */

const serve: TestCheckId = {
  kind: "test",
  project: "",
  testPath: "test/serve.test.ts",
  fullName: "serve",
};
const OLD = "Error: listen EADDRINUSE 127.0.0.1:35321 @ test/serve.test.ts:3:9";

describe("a daemon's first start under new fingerprint rules (task 011-14)", SLOW, () => {
  it("rewrites the stored fingerprints once, when it registers", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
    onTestFinished(() => store.close());
    const standing: KnownState = {
      worktreeId: repo.worktreeId,
      check: serve,
      outcome: "fail",
      validity: "current",
      pendingPhase: null,
      observedAt: 1,
      commit: null,
      origin: { kind: "own" },
      durationMs: 5,
      location: { path: "test/serve.test.ts", line: 3, column: 9 },
      summary: "listen EADDRINUSE 127.0.0.1:35321",
      fingerprint: OLD,
    };
    store.knownStates.upsertMany([standing]);
    expect(store.meta.get(META_FINGERPRINT_RULES)).toBeNull();

    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    expect(store.meta.get(META_FINGERPRINT_RULES)).toBe(String(FINGERPRINT_RULES));
    expect(store.knownStates.get(repo.worktreeId, serve)?.fingerprint).toBe(
      "Error: listen EADDRINUSE 127.0.0.1:<port> @ test/serve.test.ts:3:9",
    );
  });
});
