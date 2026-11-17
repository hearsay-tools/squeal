import { afterEach, describe, expect, it, vi } from "vitest";
import type { SentBatch } from "../../src/core/types/daemon-writes.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { type ServedWrites, serveWrites } from "./daemon-writes-helpers.js";
import { recorded, squealRepo } from "./helpers.js";

/*
 * Row 005-103 under spec 021 D15: while a daemon serves the worktree, a registration's writes
 * reach the store as one batch the daemon writes later, and its own state commits do not wait
 * for that batch. The view seed (`views.seed`) writes the states the registration read, so a
 * state the daemon commits between that read and the batch's write is not seeded as told: the
 * next boundary delivers it. An `INSERT ... SELECT FROM known_states` would read the store at
 * the batch's write and seed the new failure silently.
 */

const served: ServedWrites[] = [];
afterEach(async () => {
  for (const s of served.splice(0)) await s.close();
});

const deps = { env: {}, ensureDaemon: async () => "alive" as const, harnessProcess: () => null };
const seeds = (batch: SentBatch) => batch.sqls.some((sql) => sql.includes("json_each"));

describe("a registration's view seed while a daemon serves (row 005-103)", () => {
  it("holds what the registration read, so a failure committed before its batch is told", async () => {
    const r = squealRepo();
    r.policy({});
    r.apply(r.pass());
    const daemon = await serveWrites(r);
    served.push(daemon);
    daemon.pause();
    const start = runHook("session-start", recorded("session-start", r.root), deps);
    // Every batch before the registration's is written: its read follows them.
    await vi.waitFor(
      () => {
        if (daemon.held().some(seeds)) return;
        if (daemon.held().length > 0) {
          daemon.release();
          daemon.pause();
        }
        throw new Error("the registration's batch is not sent yet");
      },
      { timeout: 10_000, interval: 5 },
    );
    // The daemon's own commit, after the registration's read and before its batch is written.
    r.apply(r.fail());
    daemon.release();
    const out = await start;
    expect(out.stdout).not.toContain("PASS -> FAIL");
    expect(r.store.views.list(r.consumer()).map((v) => v.outcome)).toEqual(["pass"]);
    const boundary = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps);
    expect(boundary.stdout).toContain("PASS -> FAIL");
  });
});
