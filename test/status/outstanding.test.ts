import { describe, expect, it } from "vitest";
import type { EndedWait } from "../../src/cli/status-wait-lines.js";
import { waitText } from "../../src/cli/status-wait-lines.js";
import { AWAITING_INSTALL_REASON } from "../../src/core/scheduler/install.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { timeText } from "../../src/core/text.js";
import {
  awaitingInstallMetaKey,
  awaitingInstallValue,
  installCommandMetaKey,
  type LoadNow,
  type RevisionNumber,
  refinedMetaKey,
  type StatusSnapshot,
  type Store,
} from "../../src/core/types/index.js";
import { BUSY, config, doneKey, marked, QUIET } from "../cli/next-step-seed.js";
import { B, key, NOW, ref, repoWith, SLOW_FILE } from "../cli/status-wait-fixture.js";
import { check, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Row 011-29 (011 C6 as amended 2026-10-20; `tasks/011-24/design.md` 1.1
 * and section 3): status's `Outstanding:` block, one line a group of test
 * files not current, each with what advances it or why nothing does, one
 * test a group from a seeded store; at most six groups, `--full` every one,
 * and every line `--full` adds is detail.
 */

const T = "tests/a.test.ts";
const U = "src/u.test.ts";
const STARTED = NOW - 30_000;
const SINCE = timeText(STARTED);

function snapshotOf(root: string, load: LoadNow = QUIET): StatusSnapshot {
  const status = readStatus(root, { now: () => NOW, load: () => load });
  if (!status.available) throw new Error(status.message);
  return status;
}

/** The lines of the `Outstanding:` block, its heading left out. */
function outstanding(root: string, load: LoadNow = QUIET, full = false): string[] {
  const lines = formatStatus(snapshotOf(root, load), NOW, "squeal", { full }).split("\n");
  const at = lines.indexOf("Outstanding:");
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && !l.startsWith("  "));
  return lines.slice(at + 1, end);
}

/** A worktree at revision 4 whose `paths` are keyed with nothing queued and no result. */
function keyed(...paths: string[]) {
  const { repo, store } = repoWith([]);
  for (const path of paths) key(store, repo.mainId, path, null);
  return { repo, store, id: repo.mainId };
}

function openRun(store: Store, worktreeId: string, id: string, paths: readonly string[]) {
  store.runs.start({
    id,
    worktreeId,
    revision: 4 as RevisionNumber,
    testFiles: paths.map(ref),
    checkpointId: null,
    logDir: `/tmp/${id}`,
    startedAt: STARTED,
  });
}

/** `path`'s row and check running, as `startTier` writes them. */
function running(store: Store, worktreeId: string, path: string) {
  key(store, worktreeId, path, "running");
  store.knownStates.upsertMany([
    state(worktreeId, check(path, "holds"), { validity: "pending", pendingPhase: "running" }),
  ]);
}

describe("each outstanding group names what advances it (011-29, design section 3)", () => {
  it("no daemon validating: one group, start one, whatever else is not current", () => {
    const { repo, store } = repoWith([B]);
    const worktree = store.worktrees.get(repo.mainId);
    if (worktree === null) throw new Error("the fixture seeds the main worktree");
    store.worktrees.upsert({
      ...worktree,
      daemon: {
        socketPath: "/tmp/down.sock",
        startedAt: NOW - 120_000,
        heartbeatAt: NOW - 60_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0-test",
      },
    });

    expect(outstanding(repo.main)).toEqual([
      `  no daemon has validated since ${new Date(NOW - 60_000).toISOString()}; results are as of revision 4; \`squeal start\` starts one`,
    ]);
  });

  it("discovery: the daemon is still listing the test files, and the wait for it", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    store.worktrees.upsert({
      id: repo.mainId,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: {
        socketPath: "/tmp/live.sock",
        startedAt: NOW - 60_000,
        heartbeatAt: NOW - 1_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0-test",
      },
    });

    expect(outstanding(repo.main)).toEqual([
      "  the daemon is still listing this worktree's test files; `squeal status --wait 60000` waits for it",
    ]);
  });

  it("the revision's runner part: its queued files, each call's bound, and the wait for it", () => {
    const { repo, store } = repoWith([B]);
    store.meta.set(refinedMetaKey(repo.mainId), "3");

    expect(outstanding(repo.main)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^ {2}1 test file queued, revision 4 not listed yet, because the runner part waits for the run in flight, each of its calls bounded at \\d+ s: ${B}; \`squeal status --wait 60000\` waits for it$`,
        ),
      ),
    ]);
  });

  it("gh-38 A: stale under lookup-only, nothing queued: retry runs it once", () => {
    const { repo, store, id } = keyed(T);
    config(repo.main, { baseline: { onStart: "lookup-only" } });
    store.knownStates.upsertMany([
      state(id, check(T, "holds"), { validity: "stale", observedAt: 1 }),
    ]);

    expect(outstanding(repo.main)).toEqual([
      `  1 test file last passed at other inputs, nothing queued it (the baseline is lookup-only): ${T}; \`squeal retry ${T}\` runs it once`,
    ]);
  });

  it("gh-43: timed out in a tier of its own, with the load at or above the CPU count", () => {
    const { repo, store, id } = keyed(U);
    marked(store, id, U, "timed out after 600 s", { cause: "timeout" });

    expect(outstanding(repo.main, BUSY)).toEqual([
      `  1 test file timed out after 600 s; Squeal does not run it again at these inputs by itself: ${U}; \`squeal retry ${U}\` runs it once (load average 30.20 on 24 CPUs now: under that load it may time out again)`,
    ]);
    expect(outstanding(repo.main, QUIET)[0]).toMatch(/runs it once$/);
  });

  it("ran and recorded nothing: the recorded reason, retry runs it once", () => {
    const { repo, store, id } = keyed(U);
    marked(store, id, U, "3 runs in a row read paths no earlier run had read", { ran: true });

    expect(outstanding(repo.main)).toEqual([
      `  1 test file ran, nothing recorded: 3 runs in a row read paths no earlier run had read: ${U}; \`squeal retry ${U}\` runs it once`,
    ]);
  });

  it("its project's global setup failed: the next edit or run --all starts the runner again", () => {
    const { repo, store, id } = keyed(U);
    store.knownStates.upsertMany([
      state(
        id,
        { kind: "setup", project: "", testPath: "e2e/setup.ts" as never },
        { outcome: "fail" },
      ),
    ]);

    expect(outstanding(repo.main)).toEqual([
      `  1 test file without a result, its project's global setup failed: ${U}; the next edit or \`squeal run --all --wait\` starts the runner again`,
    ]);
  });

  it("no key, a runner call failed: the next edit or run --all calls the runner again", () => {
    const { repo, store } = keyed();
    store.testFileKeys.upsertMany([
      { worktreeId: repo.mainId, testFile: ref(U), key: null, revision: 4, pending: null },
    ]);

    expect(outstanding(repo.main)).toEqual([
      `  1 test file without a result, no key: its project's environment or closure is not known (a runner call failed), or a closure path is untracked: ${U}; the next edit or \`squeal run --all --wait\` calls the runner again`,
    ]);
  });

  it("no dependencies installed: the header's install command installs them", () => {
    const { repo, store, id } = keyed();
    store.testFileKeys.upsertMany([
      { worktreeId: id, testFile: ref(U), key: null, revision: 4, pending: null },
    ]);
    marked(store, id, U, AWAITING_INSTALL_REASON, { cause: "install", key: null });
    store.meta.set(awaitingInstallMetaKey(id), awaitingInstallValue(["."]));
    store.meta.set(installCommandMetaKey(id), "npm ci");

    expect(outstanding(repo.main)).toEqual([
      `  1 test file without a result, no dependencies are installed in this worktree: ${U}; \`npm ci\` installs them`,
    ]);
  });

  it("the order rule: a stale file another live worktree runs waits for that claim, not a retry", () => {
    const { repo, store, id } = keyed(T);
    store.knownStates.upsertMany([
      state(id, check(T, "holds"), { validity: "stale", observedAt: 1 }),
    ]);
    const other = repo.addWorktree("other");
    store.worktrees.upsert({
      id: other.id,
      root: other.root,
      commonDir: repo.commonDir,
      isMain: false,
      registeredAt: 2,
      daemon: {
        socketPath: "/tmp/other.sock",
        startedAt: NOW - 60_000,
        heartbeatAt: NOW - 1_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0-test",
      },
    });
    store.testFileKeys.upsertMany([
      {
        worktreeId: other.id,
        testFile: ref(T),
        key: doneKey(T),
        revision: 1 as never,
        pending: "running",
      },
    ]);

    expect(outstanding(repo.main)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^ {2}1 test file waiting for ${other.root}'s run of its key, at most until \\d\\d:\\d\\d:\\d\\d: ${T}; its result is shared here when that run stores it$`,
        ),
      ),
    ]);
  });

  it("running alone in its run: no step is needed", () => {
    const { repo, store } = repoWith([]);
    running(store, repo.mainId, B);
    openRun(store, repo.mainId, "run-b", [B]);

    expect(outstanding(repo.main)).toEqual([
      `  1 test file running since ${SINCE} in the vitest lane: ${B}`,
    ]);
  });

  it("gh-40 A: in a tier of several files, nothing runs them sooner", () => {
    const { repo, store } = repoWith([]);
    const tier = ["tests/t1.test.ts", "tests/t2.test.ts", "tests/t3.test.ts", "tests/t4.test.ts"];
    for (const path of tier) running(store, repo.mainId, path);
    openRun(store, repo.mainId, "run-tier", tier);

    expect(outstanding(repo.main)).toEqual([
      `  4 test files in the vitest tier of 4 test files running since ${SINCE}: tests/t1.test.ts, tests/t2.test.ts, tests/t3.test.ts and 1 more; no command runs them sooner (a running tier is not interrupted)`,
    ]);
  });

  it("gh-40 B: queued behind a running tier, a named wait moves one ahead when it ends", () => {
    const { repo, store } = repoWith([B]);
    running(store, repo.mainId, "tests/t1.test.ts");
    openRun(store, repo.mainId, "run-t1", ["tests/t1.test.ts"]);

    expect(outstanding(repo.main)).toEqual([
      `  1 test file running since ${SINCE} in the vitest lane: tests/t1.test.ts`,
      `  1 test file queued behind the vitest tier of 1 test file running since ${SINCE}: ${B}; \`squeal status --wait 60000 <test file>\` moves a named one ahead when that tier ends`,
    ]);
  });

  it("gh-41: queued with nothing recorded holding it says so, and where each file's state is", () => {
    const { repo } = repoWith([B, "src/c.test.ts"]);

    expect(outstanding(repo.main)).toEqual([
      `  2 test files queued; no run is open and nothing recorded holds them: ${B}, src/c.test.ts; the store records no reason the daemon has not taken them (\`squeal status --json\` lists each file's state)`,
    ]);
  });

  it("slow files the slow-tier line counts are left out, but not a running one whose project has a global setup (gh-46)", () => {
    const { repo, store } = repoWith(["test/slow2.test.ts"]);
    config(repo.main, { slow: { include: [SLOW_FILE, "test/slow2.test.ts"] } });
    running(store, repo.mainId, SLOW_FILE);
    openRun(store, repo.mainId, "run-slow", [SLOW_FILE]);
    store.knownStates.upsertMany([
      state(repo.mainId, { kind: "setup", project: "", testPath: "e2e/environment.ts" as never }),
    ]);

    expect(outstanding(repo.main)).toEqual([
      `  1 test file running since ${SINCE} in the slow vitest lane; its project's global setup (e2e/environment.ts) ran once when this slow pass started, and Squeal does not hold what it started, so another run of that project meanwhile may replace it: ${SLOW_FILE}; after an environment failure, \`squeal retry ${SLOW_FILE} --reason environment\` runs this one file again`,
    ]);
  });
});

/** Seven groups: one each of seven standings. */
function sevenGroups() {
  const { repo, store, id } = keyed(T, U, "src/n.test.ts", "src/r.test.ts", "src/t.test.ts");
  store.knownStates.upsertMany([
    state(id, check(T, "holds"), { validity: "stale", observedAt: 1 }),
  ]);
  marked(store, id, U, "timed out after 600 s", { cause: "timeout" });
  marked(store, id, "src/r.test.ts", "3 runs in a row read paths no earlier run had read", {
    ran: true,
  });
  store.testFileKeys.upsertMany([
    { worktreeId: id, testFile: ref("src/k.test.ts"), key: null, revision: 4, pending: null },
  ]);
  key(store, id, "src/q.test.ts", "queued");
  running(store, id, "tests/t1.test.ts");
  openRun(store, id, "run-t1", ["tests/t1.test.ts"]);
  return repo;
}

describe("the outstanding block's bounds (011-29)", () => {
  it("prints at most six groups, then counts the rest and names --full, which lists every group", () => {
    const repo = sevenGroups();

    const shown = outstanding(repo.main);
    const every = outstanding(repo.main, QUIET, true);

    expect(shown).toHaveLength(7);
    expect(shown.at(-1)).toBe(
      "  and 1 test file in 1 more group (`squeal status --full` lists every group)",
    );
    expect(every).toHaveLength(7);
    expect(every.slice(0, 6)).toEqual(shown.slice(0, 6));
    expect(every.at(-1)).toMatch(/^ {2}1 test file queued behind the vitest tier/);
  });

  it("every line --full adds is detail: nothing an agent acts on moves behind it", () => {
    const repo = sevenGroups();
    const s = snapshotOf(repo.main);
    const short = formatStatus(s, NOW).trimEnd().split("\n");
    const full = formatStatus(s, NOW, "squeal", { full: true }).trimEnd().split("\n");

    // The default text, its `More:` line and the count of groups past the sixth aside, leads the full text.
    const kept = short.filter((l) => !l.startsWith("More: ") && !l.startsWith("  and "));
    expect(full.slice(0, 7 + kept.length - 1).filter((l) => kept.includes(l))).toEqual(kept);
    const added = full.filter((l) => !short.includes(l));
    const detail = [
      /^$/,
      /^Worktree: /,
      /^Daemon: running, /,
      /^Inherited from other worktrees: /,
      /^Test files without checks: /,
      /^Test files without a result: /,
      /^ {2}\S+: (?:no result|ran, nothing recorded): /,
      /^ {2}and \d+ more test files?$/,
      /^Closure method: /,
      /^Store schema: /,
      /^Notes:$/,
      /^ {2}\d{4}-\d\d-\d\dT/,
      // The seventh group, which the default text counts and names `--full` for.
      /^ {2}1 test file queued behind the vitest tier /,
    ];
    for (const line of added) {
      expect(
        detail.some((re) => re.test(line)),
        line,
      ).toBe(true);
    }
    expect(added.length).toBeGreaterThan(5);
  });
});

describe("a pathless wait's quiet line says its scope (011-29, gh-41 E1)", () => {
  it("prints the default text, then says the wait does not hold for the rest of the worktree", () => {
    const { repo } = repoWith(["e2e/a001.e2e.ts", "e2e/a002.e2e.ts"]);
    const result = snapshotOf(repo.main);
    const wait = {
      outcome: "quiet",
      waitedMs: 0,
      transitions: 0,
      edit: { since: 1, testFiles: 91, pending: 0, otherTransitions: 0 },
      result,
    } as unknown as EndedWait;

    const text = waitText(wait, NOW).trimEnd().split("\n");

    expect(text.slice(0, -2)).toEqual(formatStatus(result, NOW).trimEnd().split("\n"));
    expect(text.at(-2)).toBe("");
    expect(text.at(-1)).toBe(
      "Returned on quiet: none of the 91 test files the edits since revision 1 re-keyed is pending, at revision 4 after 0.0 s; this wait does not hold for the rest of the worktree. Worktree: known failures 0; not current: 2 of 2 test files (2 queued), 2 tests (2 queued)",
    );
  });

  it("with --full, the full text before the line", () => {
    const { repo } = repoWith([B]);
    const result = snapshotOf(repo.main);
    const wait = { outcome: "quiet", waitedMs: 0, transitions: 0, result } as unknown as EndedWait;

    expect(waitText(wait, NOW, "squeal", { full: true })).toContain(
      `${formatStatus(result, NOW, "squeal", { full: true })}\nReturned on quiet: `,
    );
  });
});
