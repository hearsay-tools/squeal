import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHeld, startView } from "../../src/cli/status-wait-held.js";
import { type Every, keptAtStart, readEvery } from "../../src/cli/wait/every-state.js";
import { writeCommitReports } from "../../src/core/commit/store.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { endInstallWait, recordInstallWait } from "../../src/core/scheduler/install-wait.js";
import { publishNarrowAsks } from "../../src/core/scheduler/narrow-asks-row.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import { publishGroupActivity } from "../../src/core/slow/state.js";
import { readHeader } from "../../src/core/state/header.js";
import { recordOptimizerOff } from "../../src/core/state/optimizer-note.js";
import type { EpochMs, RevisionNumber } from "../../src/core/types/common.js";
import { SLOW_GROUP } from "../../src/core/types/scheduler.js";
import type { StatusHeader } from "../../src/core/types/status.js";
import {
  FAST,
  inTurn,
  keys,
  NOW,
  revise,
  type Seeded,
  SLOW_A,
  SLOW_B,
  SLOW_POLICY,
  seed,
  states,
} from "../status/slow-tier-seed.js";
import { armMarkers } from "./closure-trust.js";

/*
 * Row 011-345: the fallback `status --wait` keeps the header's part made
 * from (states, keys, policy) while the states marker stays and the policy
 * reads the same, and reads the rest fresh each poll: the revision, the
 * runner part, the install wait, checkpoints, the lanes' activity, the
 * consumers' turns, the commit line, the optimizer note. After each kind of
 * write, and on a quiet poll, the kept header equals `readHeader`'s, key
 * order included, as a payload prints it.
 */

let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-kept-header-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

const GROUPS_POLICY = {
  slow: { include: ["test/e2e/**/*.test.ts"] },
  checks: [
    { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" },
    { name: "unit", runner: "vitest", tests: ["src/**"], at: "pause" },
  ],
};

const REPORT = {
  commit: "abc1234def5678",
  revision: 2,
  at: NOW,
  tests: { files: 3, failures: 0, notDetermined: 1, running: 0, unknown: 0 },
};

/** "kept" when the poll kept the header's part made from the states, keys and policy. */
type Made = "kept" | "made";

/** A fallback wait's polls over `s`, each checked against a full read; `header` is the last poll's. */
function waiting({ repo, store }: Seeded) {
  armMarkers(store);
  const id = repo.mainId;
  const view = startView(store.knownStates.list(id));
  const every: Every = { kept: keptAtStart(store, id, store.knownStates.list(id)) };
  let last: StatusHeader | undefined;
  const header = (): StatusHeader => last ?? expect.fail("no poll yet");
  const poll = (): Made => {
    const before = every.kept?.part;
    const read = readEvery(store, id, view, every);
    last = read.header;
    const full = readHeader(store, id);
    expect(read.header).toEqual(full);
    expect(JSON.stringify(read.header)).toBe(JSON.stringify(full));
    expect(read).toEqual(readHeld(store, id, view, null));
    return before !== undefined && every.kept?.part === before ? "kept" : "made";
  };
  return { poll, header };
}

describe.each([
  ["a slow tier", SLOW_POLICY],
  ["check groups", GROUPS_POLICY],
])("the kept header part with %s (row 011-345)", (_, policy) => {
  it("equals a full read after each kind of write, and is made again only for states, keys or policy", () => {
    const s = seed(policy, { revisions: 2 });
    const { repo, store } = s;
    const id = repo.mainId;
    states(
      store,
      repo,
      [{ validity: "current", observedAt: 1 }, { observedAt: 2 }],
      [SLOW_A, FAST],
    );
    recordRefinedApplied(store, id, 2 as RevisionNumber);
    const { poll, header } = waiting(s);
    const grouped = "checks" in policy;
    /** The lane's activity: the slow tier's, or the `e2e` group's with a `checks` key. */
    const activity = () =>
      grouped
        ? header().groupTiers?.find((tier) => tier.name === "e2e")?.activity
        : header().slowTier?.activity;

    expect(poll()).toBe("made");
    expect(poll()).toBe("kept");

    // Fresh each poll: no state or key row changes.
    revise(store, repo, ["src/a.ts"]);
    expect(poll()).toBe("kept");
    expect(header()).toMatchObject({ revision: 3, runnerPartPending: true });
    recordRefinedApplied(store, id, 3 as RevisionNumber);
    expect(poll()).toBe("kept");
    expect(header().runnerPartPending).toBe(false);
    recordInstallWait(store, id, [], "pnpm install");
    expect(poll()).toBe("kept");
    expect(header()).toMatchObject({ awaitingInstall: true, installCommand: "pnpm install" });
    endInstallWait(store, id);
    expect(poll()).toBe("kept");
    expect(header().awaitingInstall).toBeUndefined();
    store.checkpoints.start({
      id: "cp",
      worktreeId: id,
      revision: 3 as RevisionNumber,
      kind: "run-all",
      testFiles: [],
      startedAt: NOW,
    });
    store.checkpoints.finish("cp", "completed", NOW);
    expect(poll()).toBe("kept");
    expect(header().fullSuite.atCurrentRevision).toBe(true);
    recordOptimizerOff(store, id, ["web"]);
    expect(poll()).toBe("kept");
    expect(header().optimizerOff).toBeDefined();
    writeCommitReports(store.meta, id, REPORT.commit, REPORT);
    expect(poll()).toBe("kept");
    expect(header().commitLine !== undefined).toBe(grouped);

    // A key row is a states write: the lane's file runs.
    keys(store, repo, { [SLOW_A]: "running", [SLOW_B]: "queued" });
    expect(poll()).toBe("made");
    const lane = "checks" in policy ? "e2e" : SLOW_GROUP;
    const running = { kind: "running" as const, path: SLOW_A, since: NOW, lastDurationMs: null };
    expect(activity()).toBeNull();
    publishGroupActivity(store, id, lane, running);
    expect(poll()).toBe("kept");
    expect(activity()).toEqual(running);
    // Waiting for a pause with no agent in a turn is waiting for nothing; in a turn, for the pause.
    publishGroupActivity(store, id, lane, { kind: "waiting", for: "idle" });
    expect(poll()).toBe("kept");
    expect(activity()).toBeNull();
    inTurn(s);
    expect(poll()).toBe("kept");
    expect(activity()).toEqual({ kind: "waiting", for: "idle" });

    // A state write.
    states(store, repo, [{ validity: "pending", pendingPhase: "queued" }], [FAST]);
    expect(poll()).toBe("made");
    expect(header().counts.pending).toBe(1);
    expect(poll()).toBe("kept");

    // The policy file changes with no row written.
    const narrowed = { ...policy, slow: { include: ["test/e2e/a.test.ts"] } };
    const wide = header();
    writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify(narrowed));
    expect(poll()).toBe("made");
    expect(poll()).toBe("kept");
    if (!grouped) expect(header().slowTier?.testFiles).toBeLessThan(wide.slowTier?.testFiles ?? 0);
    writeFileSync(join(repo.main, "squeal.config.json"), "{}");
    expect(poll()).toBe("made");
    expect(header()).not.toHaveProperty(grouped ? "groupTiers" : "slowTier");
    expect(poll()).toBe("kept");
  });
});

/*
 * Row 011-426, review 0.1.650 B1: a held group's queued file is on request
 * until the scheduler publishes a request that runs it. Publishing one is no
 * states write, so the kept part must be made again when the request state
 * changes while the states and the keys stay as they were.
 */
describe("the kept header part with a held group (row 011-426)", () => {
  const HELD = {
    checks: [{ name: "browser", runner: "vitest", tests: ["test/e2e/**"], at: "manual" }],
  };

  it("is made again when a request starts or ends, with the keys unchanged", () => {
    const s = seed(HELD, { revisions: 2 });
    const { repo, store } = s;
    const id = repo.mainId;
    keys(store, repo, { [SLOW_A]: "queued", [SLOW_B]: "queued" });
    recordRefinedApplied(store, id, 2 as RevisionNumber);
    const { poll, header } = waiting(s);
    expect(poll()).toBe("made");
    expect(poll()).toBe("kept");
    expect(header().testFilesByPhase).toEqual({ running: 0, queued: 0, onRequest: 2 });

    // `squeal run browser`: the whole group is asked.
    publishNarrowAsks(store, id, [], NOW as EpochMs, { requested: ["browser"] });
    expect(poll()).toBe("made");
    expect(header().testFilesByPhase).toEqual({ running: 0, queued: 2 });
    expect(poll()).toBe("kept");

    // The request ends; a narrow ask for one file stays.
    const a = store.testFileKeys.list(id).find((row) => row.testFile.path === SLOW_A);
    publishNarrowAsks(
      store,
      id,
      [[testFileId(a?.testFile ?? { project: "", path: SLOW_A }), String(a?.key)]],
      NOW as EpochMs,
    );
    expect(poll()).toBe("made");
    expect(header().testFilesByPhase).toEqual({ running: 0, queued: 1, onRequest: 1 });
  });
});
