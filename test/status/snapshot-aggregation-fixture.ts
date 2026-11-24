import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { askRetry } from "../../src/core/retry/records.js";
import { addCommandHold } from "../../src/core/scheduler/hold-rows.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { CheckId } from "../../src/core/types/check.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { KnownState } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import { check, type FakeRepo, fakeRepo, fileCheck, seedStore, state } from "./helpers.js";
import { FAST, keys, NOW, SLOW_A, SLOW_B, SLOW_C, SLOW_POLICY, seed } from "./slow-tier-seed.js";

/*
 * Row 025-11 (spec 025 D11): worktrees that hold every kind of known state
 * status counts, for `snapshot-aggregation.test.ts`, which reads each by SQL
 * and from `knownStates.list`. Each writes only through the store's own
 * repositories and helpers, so the same fixtures read alike at an earlier
 * release.
 */

export { NOW };

export interface Scenario {
  readonly repo: FakeRepo;
  readonly store: Store;
}

const B_FILE = "src/b.test.ts";
const C_FILE = "src/c.test.ts";
const D_FILE = "src/d.test.ts";
const SETUP: CheckId = { kind: "setup", project: "", testPath: "vitest.setup.ts" as never };
const API_SETUP: CheckId = { kind: "setup", project: "api", testPath: "api/setup.ts" as never };
const OTHER_SETUP: CheckId = { kind: "setup", project: "web", testPath: "web/setup.ts" as never };
const GROUPS = {
  checks: [
    { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop", after: ["unit"] },
    { name: "unit", runner: "vitest", tests: ["src/**"], at: "edit" },
  ],
};

function put(s: Scenario, list: readonly KnownState[]): void {
  s.store.knownStates.upsertMany(list);
}

const at = (s: Scenario, c: CheckId, o: Partial<KnownState> = {}) => state(s.repo.mainId, c, o);

/** Every listed file's test and file checks current and passing, at revisions 1 to 3. */
function allCurrent(s: Scenario): void {
  const paths = [FAST, SLOW_A, SLOW_B];
  put(
    s,
    paths.flatMap((path, i) => [
      at(s, check(path, "one"), { observedAt: i + 1 }),
      at(s, check(path, "two"), { observedAt: 2, outcome: "skip" }),
      at(s, fileCheck(path), { observedAt: 3 }),
    ]),
  );
}

/** A failing test, a stale failing file check and a failed and a passing global setup. */
function failures(s: Scenario): void {
  put(s, [
    at(s, check(SLOW_A, "two"), { outcome: "fail", fingerprint: "Error: two", summary: "two" }),
    at(s, fileCheck(SLOW_B), { outcome: "fail", validity: "stale", fingerprint: "Error: b" }),
    at(s, SETUP, { outcome: "fail", fingerprint: "Error: setup", summary: "setup failed" }),
    at(s, OTHER_SETUP),
  ]);
}

/** Queued and running checks, with and without a phase, and an open run holding a queued file. */
function pending(s: Scenario): void {
  keys(s.store, s.repo, { [FAST]: "queued", [B_FILE]: "running", [C_FILE]: "queued" });
  put(s, [
    at(s, check(FAST, "one"), { validity: "pending", pendingPhase: "queued" }),
    at(s, check(FAST, "three"), { validity: "pending", pendingPhase: null, outcome: "unknown" }),
    at(s, check(B_FILE, "runs"), { validity: "pending", pendingPhase: "running" }),
    at(s, fileCheck(B_FILE), { validity: "pending", pendingPhase: null }),
    at(s, check(SLOW_A, "one"), { validity: "pending", pendingPhase: "queued" }),
  ]);
  s.store.runs.start({
    id: "run-1",
    worktreeId: s.repo.mainId,
    revision: 2,
    testFiles: [{ project: "", path: FAST }],
    checkpointId: null,
    logDir: "/tmp/run-1",
    startedAt: NOW - 5_000,
  });
}

/** Stale and unknown checks, an unkeyed file, a file without checks and a setup at a file's path. */
function staleAndUnknown(s: Scenario): void {
  s.store.testFileKeys.upsertMany([
    {
      worktreeId: s.repo.mainId,
      testFile: { project: "", path: D_FILE },
      key: null,
      revision: 1,
      pending: null,
    } as never,
  ]);
  keys(s.store, s.repo, { [C_FILE]: null, [SLOW_C]: null });
  put(s, [
    at(s, check(SLOW_A, "one"), { validity: "stale" }),
    at(s, check(FAST, "one"), { validity: "unknown", outcome: "unknown", summary: "timed out" }),
    at(s, check(FAST, "two"), { validity: "unknown", outcome: "unknown" }),
    at(s, check(D_FILE, "keyless"), { validity: "unknown", outcome: "unknown" }),
    at(s, { kind: "setup", project: "", testPath: SLOW_C as never }, { outcome: "fail" }),
  ]);
}

/** Current results inherited from two worktrees at two commits each, a global setup's among them. */
function inherited(s: Scenario): void {
  const from = (worktreeId: string, commit: string | null) =>
    ({ kind: "inherited", worktreeId, commit }) as KnownState["origin"];
  // Checks no later fill of `mixed` names, so they stay inherited there.
  put(s, [
    at(s, check(FAST, "i1"), { origin: from("aaaaaaaaaaaaaaaa", "c1") }),
    at(s, check(FAST, "i2"), { origin: from("aaaaaaaaaaaaaaaa", "c1"), outcome: "skip" }),
    at(s, fileCheck(FAST), { origin: from("aaaaaaaaaaaaaaaa", "c2") }),
    at(s, check(SLOW_A, "i3"), { origin: from("bbbbbbbbbbbbbbbb", null) }),
    at(s, fileCheck(SLOW_A), { origin: from("bbbbbbbbbbbbbbbb", "c3") }),
    at(s, check(SLOW_B, "i4"), { origin: from("bbbbbbbbbbbbbbbb", "c3"), validity: "stale" }),
    at(s, API_SETUP, { origin: from("aaaaaaaaaaaaaaaa", "c1") }),
  ]);
}

/** Two CI imports of the listed files, and current results adopted from one, in part. */
function imported(s: Scenario): void {
  const keyOf = (path: string) =>
    s.store.testFileKeys.list(s.repo.mainId).find((k) => k.testFile.path === path)?.key ?? "";
  for (const [run, key] of [
    ["1", (p: string) => keyOf(p)],
    ["2", (p: string) => `other-${p}`],
  ] as const) {
    importResults(s.store, bundle(run, [FAST, SLOW_A, SLOW_B], key), {
      importId: `i${run}`,
      fileHash: `h${run}`,
      now: 5,
    });
  }
  const from = (importId: string) =>
    ({ kind: "imported", importId, commit: "1".repeat(40) }) as KnownState["origin"];
  put(s, [
    at(s, check(FAST, "one"), { origin: from("i1") }),
    at(s, check(FAST, "two"), { origin: from("i1"), outcome: "skip" }),
    at(s, fileCheck(FAST), { origin: from("i1") }),
    at(s, check(SLOW_A, "one"), { origin: from("i1") }),
    at(s, fileCheck(SLOW_B), { origin: from("i2") }),
  ]);
}

function bundle(
  runId: string,
  paths: readonly string[],
  key: (p: string) => string,
): ResultsBundle {
  const commit = runId.repeat(40).slice(0, 40);
  const testFiles = paths.map((path) => ({
    project: "",
    path,
    key: key(path),
    closure: { paths: [path], complete: true, method: "static imports plus declared inputs" },
    observed: {},
  }));
  return {
    format: "squeal-results/1",
    header: {
      squealVersion: "0.0.0",
      keyFormat: KEY_FORMAT_VERSION,
      commit,
      dirty: false,
      createdAt: 1,
      source: { kind: "github", repository: "o/r", runId, ref: null, event: "push", sha: commit },
    },
    environments: [],
    testFiles,
    observedStartup: [],
    results: testFiles.map((f) => ({
      project: "",
      testPath: f.path,
      kind: "test" as const,
      fullName: "holds",
      location: null,
      key: f.key,
      outcome: "pass" as const,
      durationMs: 3,
    })),
  } as ResultsBundle;
}

/** A command hold and pending retries over a mix of states. */
function holdsAndRetries(s: Scenario): void {
  addCommandHold(s.store, s.repo.mainId, {
    token: "t",
    since: (NOW - 1_000) as EpochMs,
    until: (NOW + 60_000) as EpochMs,
    command: "sleep 60",
    wrapper: null,
    child: null,
  });
  for (const path of [FAST, SLOW_B]) {
    const key = s.store.testFileKeys.list(s.repo.mainId).find((k) => k.testFile.path === path)?.key;
    askRetry(s.store, {
      testFile: { project: "", path },
      key: key as string,
      session: "s1",
      reason: "load",
      at: NOW,
      worktreeId: s.repo.mainId,
    });
  }
}

/** Every kind at once, the later over the earlier where they name one check. */
function mixed(s: Scenario): void {
  inherited(s);
  failures(s);
  staleAndUnknown(s);
  pending(s);
  holdsAndRetries(s);
}

/** `fill` over every listed file's checks current (`allCurrent`). */
const over =
  (...fills: ((s: Scenario) => void)[]) =>
  (s: Scenario) => {
    allCurrent(s);
    for (const fill of fills) fill(s);
  };

const PLAIN = { policy: null, fill: (_: Scenario) => {} };

/** Each scenario's policy (`null`: none written) and states. */
export const SCENARIOS: Readonly<
  Record<string, { policy: object | null; fill: (s: Scenario) => void; alive?: boolean }>
> = {
  "listed, no states": PLAIN,
  "all current": { policy: null, fill: allCurrent },
  failures: { policy: null, fill: over(failures) },
  pending: { policy: null, fill: over(pending) },
  "stale and unknown": { policy: null, fill: over(staleAndUnknown) },
  inherited: { policy: null, fill: over(inherited) },
  imported: { policy: null, fill: over(imported) },
  "holds and retries": { policy: null, fill: over(pending, holdsAndRetries) },
  "slow tier": { policy: SLOW_POLICY, fill: over(mixed) },
  "check groups": { policy: GROUPS, fill: over(mixed) },
  "no daemon": { policy: SLOW_POLICY, fill: over(mixed), alive: false },
  mixed: { policy: null, fill: over(mixed) },
};

/** `name`'s worktree; `"no row"` is a store with no `worktrees` row and no states. */
export function scenario(name: string): Scenario {
  if (name === "no row") {
    const repo = fakeRepo();
    return { repo, store: seedStore(repo) };
  }
  const spec = SCENARIOS[name];
  if (spec === undefined) throw new Error(`no scenario ${name}`);
  const s = seed(spec.policy, { revisions: 2, alive: spec.alive ?? true });
  spec.fill(s);
  return s;
}

export const NAMES = ["no row", ...Object.keys(SCENARIOS)];
