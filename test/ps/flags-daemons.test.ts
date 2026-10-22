import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drainLeftMs, flag } from "../../src/core/ps/flags.js";
import type { DaemonWork, FlagFindings, FoundDaemon } from "../../src/core/ps/model.js";
import {
  claudeInstalled,
  consumer,
  foundDaemon,
  HOUR,
  installScript,
  MINUTE,
  type ModelHost,
  makeRoot,
  modelHost,
  modelOf,
  NOW,
  workOf,
  writeAged,
} from "./fixture-model.js";

/*
 * Spec 014 D7, the daemons: each flag's flagged case and the healthy state
 * it could take for it (`research/should-not-be-up.md` 1, fifth column),
 * and the two information states.
 */

let host: ModelHost;
beforeEach(() => {
  host = modelHost();
  claudeInstalled(host.places.home, "0.1.235");
});
afterEach(() => {
  rmSync(host.base, { recursive: true, force: true });
});

interface At {
  readonly ageS?: number;
  readonly holdsLock?: boolean | null;
  readonly awaitLock?: boolean;
  readonly root?: string | null;
  readonly script?: string;
  readonly version?: string;
  readonly worktreeId?: string;
}

/** A daemon of an existing root, run from the installed Claude Code bundle. */
function daemonAt(pid: number, o: At = {}): FoundDaemon {
  const root = o.root === undefined ? makeRoot(host, `r${pid}`).root : o.root;
  const script = o.script ?? installScript(host.places.home, "claude", o.version ?? "0.1.235");
  return foundDaemon({ ...o, pid, root, script });
}

function one(daemon: FoundDaemon, first: DaemonWork | null = workOf(daemon), second = first) {
  return flag(modelOf({ host, daemons: [{ daemon, first, second }] }));
}

const names = (findings: FlagFindings, pid: number) =>
  (findings.daemons.get(pid) ?? []).map((f) => f.flag);

it("a serving daemon of the installed release has no flag and no unknown", () => {
  const findings = one(daemonAt(4100));
  expect(names(findings, 4100)).toEqual([]);
  expect(findings.states.size).toBe(0);
  expect(findings.unknown).toEqual([]);
});

it("a starting daemon under its predecessor's row takes none of that row's state as its own", () => {
  const d = daemonAt(4100, { ageS: 3 });
  const predecessor = workOf(d, {
    record: null,
    recordedStartedAt: NOW - 3 * HOUR,
    token: null,
    lastUse: null,
    departedAt: NOW - 2 * HOUR,
    consumers: [consumer({ alive: false })],
  });
  const findings = one(d, predecessor);
  expect(names(findings, 4100)).toEqual([]);
  expect(findings.states.size).toBe(0);
  expect(findings.unknown).toEqual([
    {
      what: "flag orphan-test-process",
      why: "the token of daemon 4100 is unread, so a mark may be its",
    },
  ]);
});

describe("root-gone", () => {
  it("flags a missing root, and a missing gitdir of a linked worktree, with kill", () => {
    const gone = daemonAt(4100, { root: join(host.base, "removed") });
    expect(one(gone).daemons.get(4100)).toEqual([
      {
        flag: "root-gone",
        reason: `its root ${join(host.base, "removed")} is missing`,
        command: "kill 4100",
      },
    ]);
    const linked = join(host.base, "linked");
    mkdirSync(linked);
    writeFileSync(
      join(linked, ".git"),
      `gitdir: ${join(host.base, "main", ".git", "worktrees", "x")}\n`,
    );
    expect(names(one(daemonAt(4101, { root: linked })), 4101)).toEqual(["root-gone"]);
  });

  it("leaves a linked worktree whose gitdir is there alone, and names a relative root unknown", () => {
    const gitdir = join(host.base, "main", ".git", "worktrees", "x");
    mkdirSync(gitdir, { recursive: true });
    const linked = join(host.base, "linked");
    mkdirSync(linked);
    writeFileSync(join(linked, ".git"), `gitdir: ${gitdir}\n`);
    expect(names(one(daemonAt(4100, { root: linked })), 4100)).toEqual([]);
    const relative = one(daemonAt(4101, { root: null }));
    expect(relative.unknown).toContainEqual({
      what: "daemon 4101 flag root-gone",
      why: "its root argument is relative",
    });
  });
});

describe("install-gone", () => {
  it("flags a bundle that is gone, with squeal stop", () => {
    const script = join(
      host.places.home,
      ".claude/plugins/cache/hearsay/squeal/0.1.235x/dist/cli/squeal.mjs",
    );
    const d = daemonAt(4100, { script });
    const [f] = one(d).daemons.get(4100) ?? [];
    expect(f).toEqual({
      flag: "install-gone",
      reason: `its bundle ${join(host.places.home, ".claude/plugins/cache/hearsay/squeal/0.1.235x/dist")} is missing`,
      command: `squeal stop ${d.root}`,
    });
  });
  it("quotes a root with a space and a quote in its squeal stop", () => {
    const root = join(host.base, "it's a root");
    mkdirSync(join(root, ".git"), { recursive: true });
    const script = join(
      host.places.home,
      ".claude/plugins/cache/hearsay/squeal/0.1.230/dist/cli/squeal.mjs",
    );
    const [f] = one(daemonAt(4100, { root, script })).daemons.get(4100) ?? [];
    expect(f?.command).toBe(`squeal stop '${host.base}/it'\\''s a root'`);
  });
});

describe("older", () => {
  it("flags a version older than the one its harness installs now", () => {
    const d = daemonAt(4100, { version: "0.1.234" });
    expect(one(d).daemons.get(4100)).toEqual([
      {
        flag: "older",
        reason: "version 0.1.234; claude installs 0.1.235",
        command: `squeal stop ${d.root}`,
      },
    ]);
  });

  it("is the information state while a session of an older version is alive, never a flag", () => {
    const d = daemonAt(4100, { version: "0.1.234" });
    const held = one(d, workOf(d, { consumers: [consumer({ version: "0.1.234" })] }));
    expect(names(held, 4100)).toEqual([]);
    expect(held.states.get(4100)).toBe("older (session 3212240 holds it)");
    const left = one(d, workOf(d, { consumers: [consumer({ version: "0.1.234", alive: false })] }));
    expect(names(left, 4100)).toContain("older");
  });

  it("reads Codex's newest cache directory beside its own, and names a missing install unknown", () => {
    for (const v of ["0.1.234", "0.1.236", "notes"])
      mkdirSync(join(host.places.home, ".codex/plugins/cache/hearsay/squeal", v), {
        recursive: true,
      });
    const codex = daemonAt(4100, { script: installScript(host.places.home, "codex", "0.1.234") });
    expect(one(codex).daemons.get(4100)?.[0]?.reason).toBe(
      "version 0.1.234; codex installs 0.1.236",
    );
    rmSync(join(host.places.home, ".claude", "plugins", "installed_plugins.json"));
    const blind = one(daemonAt(4101, { version: "0.1.234" }));
    expect(names(blind, 4101)).toEqual([]);
    expect(blind.unknown.map((u) => u.what)).toEqual(["daemon 4101 flag older"]);
  });
});

describe("no-lock and duplicate", () => {
  it("flags a waiter past 40 s, or 130 s with --await-lock, and the one without the lock of a root", () => {
    const holder = daemonAt(4100);
    const loser = daemonAt(4101, { root: holder.root, holdsLock: false, ageS: 41 });
    const successor = daemonAt(4102, {
      root: holder.root,
      holdsLock: false,
      awaitLock: true,
      ageS: 131,
    });
    const findings = flag(
      modelOf({
        host,
        daemons: [
          { daemon: holder, first: workOf(holder) },
          { daemon: loser },
          { daemon: successor },
        ],
      }),
    );
    expect(names(findings, 4100)).toEqual([]);
    expect(findings.daemons.get(4101)).toEqual([
      {
        flag: "no-lock",
        reason: "it has waited 41 s for its lock, past 40 s",
        command: "kill 4101",
      },
      {
        flag: "duplicate",
        reason: `daemon 4100 holds the lock of its root ${holder.root}`,
        command: "kill 4101",
      },
    ]);
    expect(names(findings, 4102)).toEqual(["no-lock", "duplicate"]);
  });

  it("leaves a loser's retry and an --await-lock successor alone within their waits", () => {
    const holder = daemonAt(4100);
    const loser = daemonAt(4101, { root: holder.root, holdsLock: false, ageS: 39 });
    const successor = daemonAt(4102, {
      root: holder.root,
      holdsLock: false,
      awaitLock: true,
      ageS: 120,
    });
    const findings = flag(
      modelOf({
        host,
        daemons: [
          { daemon: holder, first: workOf(holder) },
          { daemon: loser },
          { daemon: successor },
        ],
      }),
    );
    expect([...findings.daemons.values()].flat()).toEqual([]);
  });

  it("flags two holders of one root at once, and leaves two waiters to no-lock", () => {
    const a = daemonAt(4100);
    const b = daemonAt(4101, { root: a.root });
    const both = flag(
      modelOf({
        host,
        daemons: [
          { daemon: a, first: workOf(a) },
          { daemon: b, first: workOf(b) },
        ],
      }),
    );
    expect(both.daemons.get(4101)).toEqual([
      {
        flag: "duplicate",
        reason: `daemon 4100 holds a lock of its root ${a.root} too`,
        command: "kill 4101  # or 4100: keep one",
      },
    ]);
    expect(names(both, 4100)).toEqual(["duplicate"]);
    const c = daemonAt(4102, { holdsLock: false, ageS: 60 });
    const d = daemonAt(4103, { root: c.root, holdsLock: false, ageS: 60 });
    const waiting = flag(modelOf({ host, daemons: [{ daemon: c }, { daemon: d }] }));
    expect([names(waiting, 4102), names(waiting, 4103)]).toEqual([["no-lock"], ["no-lock"]]);
  });

  it("two holders of one lock file are the two readings': the lock passed, neither is a duplicate, and a third that waited is (lessons.md P9)", () => {
    const a = daemonAt(4100, { worktreeId: "00000000000a0a0a" });
    const b = daemonAt(4101, { root: a.root, worktreeId: "00000000000a0a0a", awaitLock: true });
    const passed = flag(
      modelOf({
        host,
        daemons: [
          { daemon: a, first: workOf(a) },
          { daemon: b, first: workOf(b) },
        ],
      }),
    );
    expect([names(passed, 4100), names(passed, 4101)]).toEqual([[], []]);
    const c = daemonAt(4102, {
      root: a.root,
      worktreeId: "00000000000a0a0a",
      holdsLock: false,
      ageS: 60,
    });
    const waited = flag(
      modelOf({
        host,
        daemons: [{ daemon: a, first: workOf(a) }, { daemon: b, first: workOf(b) }, { daemon: c }],
      }),
    );
    expect(waited.daemons.get(4102)).toEqual([
      {
        flag: "no-lock",
        reason: "it has waited 60 s for its lock, past 40 s",
        command: "kill 4102",
      },
      {
        flag: "duplicate",
        reason: `daemons 4100, 4101 held the lock of its root ${a.root} in turn`,
        command: "kill 4102",
      },
    ]);
    expect([names(waited, 4100), names(waited, 4101)]).toEqual([[], []]);
  });

  // `reviews/wave-5.md` B2: a lock that passed within one lock file hides no holder of another.
  it("[A, A, B]: the lock A passed, and B's holder is a duplicate of A's holders", () => {
    const a1 = daemonAt(4100, { worktreeId: "000000000000000a" });
    const a2 = daemonAt(4101, { root: a1.root, worktreeId: "000000000000000a", awaitLock: true });
    const b = daemonAt(4102, { root: a1.root, worktreeId: "000000000000000b" });
    const findings = flag(
      modelOf({ host, daemons: [a1, a2, b].map((d) => ({ daemon: d, first: workOf(d) })) }),
    );
    for (const pid of [4100, 4101])
      expect(findings.daemons.get(pid)).toEqual([
        {
          flag: "duplicate",
          reason: `daemon 4102 holds a lock of its root ${a1.root} too`,
          command: `kill ${pid}  # or 4102: keep one`,
        },
      ]);
    expect(findings.daemons.get(4102)).toEqual([
      {
        flag: "duplicate",
        reason: `daemons 4100, 4101 held a lock of its root ${a1.root} too`,
        command: "kill 4102  # or 4100, 4101: keep one",
      },
    ]);
  });

  it("[A, A, B, B]: both locks passed, and each lock's holders are duplicates of the other's", () => {
    const a1 = daemonAt(4100, { worktreeId: "000000000000000a" });
    const ids = ["000000000000000a", "000000000000000b", "000000000000000b"];
    const rest = ids.map((worktreeId, i) => daemonAt(4101 + i, { root: a1.root, worktreeId }));
    const findings = flag(
      modelOf({ host, daemons: [a1, ...rest].map((d) => ({ daemon: d, first: workOf(d) })) }),
    );
    const other = (pid: number) => (pid < 4102 ? "4102, 4103" : "4100, 4101");
    for (const pid of [4100, 4101, 4102, 4103])
      expect(findings.daemons.get(pid)).toEqual([
        {
          flag: "duplicate",
          reason: `daemons ${other(pid)} held a lock of its root ${a1.root} too`,
          command: `kill ${pid}  # or ${other(pid)}: keep one`,
        },
      ]);
  });

  it("with one reading unread, a daemon whose lock it misses is unknown: no duplicate names it or its root's holder (reviews/wave-5.md B1, B2)", () => {
    const a = daemonAt(4100);
    const b = daemonAt(4101, { root: a.root, holdsLock: null, ageS: 300 });
    const c = daemonAt(4102, { holdsLock: null, ageS: 300 });
    const d = daemonAt(4103, { root: c.root, holdsLock: null, ageS: 300 });
    const findings = flag(
      modelOf({
        host,
        locksRead: "one",
        daemons: [a, b, c, d].map((x) => ({ daemon: x, first: workOf(x) })),
      }),
    );
    expect([4100, 4101, 4102, 4103].map((pid) => names(findings, pid))).toEqual([[], [], [], []]);
    for (const [pid, root] of [
      [4101, a.root],
      [4102, c.root],
      [4103, c.root],
    ] as const)
      expect(findings.unknown).toContainEqual({
        what: `daemon ${pid} flag duplicate`,
        why: `whether it holds a lock of its root ${root} is unknown`,
      });
    const why =
      "one of the window's two /proc/locks readings cannot be read, so a lock the other misses is unknown, not absent";
    for (const what of ["flag no-lock", "flag hung", "flag foreign-permit", "phase stopping"])
      expect(findings.unknown).toContainEqual({ what, why });
  });

  it("without lock state names both pids, and names the rules it cannot evaluate", () => {
    const a = daemonAt(4100, { holdsLock: null });
    const b = daemonAt(4101, { root: a.root, holdsLock: null, ageS: 300 });
    const findings = flag(modelOf({ host, locks: null, daemons: [{ daemon: a }, { daemon: b }] }));
    expect(findings.daemons.get(4101)).toEqual([
      {
        flag: "duplicate",
        reason: `daemon 4100 has its root ${a.root} too; which holds the lock is unknown`,
        command: "kill 4101  # or 4100: whichever holds no lock",
      },
    ]);
    expect(names(findings, 4100)).toEqual(["duplicate"]);
    for (const what of ["flag no-lock", "flag hung", "flag foreign-permit", "phase stopping"])
      expect(findings.unknown).toContainEqual({ what, why: "the source has no lock state (D10)" });
  });
});

describe("hung", () => {
  it("flags a serving daemon whose heartbeat is past two intervals on both samples", () => {
    const d = daemonAt(4100);
    const stale = workOf(d, { recordOver: { heartbeatAt: NOW - 11_000 } });
    expect(one(d, stale).daemons.get(4100)).toEqual([
      {
        flag: "hung",
        reason: "its heartbeat is 11 s old on both samples, past two intervals",
        command: "kill 4100; sleep 5; kill -9 4100",
      },
    ]);
  });

  it("leaves a daemon whose store was busy past one heartbeat and that beat by the second", () => {
    const d = daemonAt(4100);
    const stale = workOf(d, { recordOver: { heartbeatAt: NOW - 11_000 } });
    expect(names(one(d, stale, workOf(d)), 4100)).toEqual([]);
  });
});

describe("departure, drain and idle", () => {
  const departed = (d: FoundDaemon, agoMs: number, over: Partial<DaemonWork> = {}) =>
    workOf(d, { departedAt: NOW - agoMs, ...over });

  it("flags past-departure a minute after the last session left with nothing to drain", () => {
    const d = daemonAt(4100, { ageS: 7200 });
    expect(one(d, departed(d, 2 * MINUTE)).daemons.get(4100)).toEqual([
      {
        flag: "past-departure",
        reason: "its last session left 2m ago, and no slow work is left",
        command: `squeal stop ${d.root}`,
      },
    ]);
    expect(names(one(d, departed(d, 30_000)), 4100)).toEqual([]);
  });

  it("is draining with the minutes left while slow work or a checkpoint waits", () => {
    const d = daemonAt(4100, { ageS: 7200 });
    const draining = departed(d, 38 * MINUTE, { slowWaiting: true });
    const findings = one(d, draining);
    expect(names(findings, 4100)).toEqual([]);
    expect(findings.states.get(4100)).toBe("draining 22m left");
    expect(drainLeftMs(draining, NOW)).toBe(22 * MINUTE);
    const checkpoint = { id: "c1", startedAt: NOW - HOUR, lane: null, files: 3 };
    expect(one(d, departed(d, 10 * MINUTE, { checkpoints: [checkpoint] })).states.get(4100)).toBe(
      "draining 50m left",
    );
  });

  it("flags a drain past daemon.idleExitMinutes as past-departure", () => {
    const d = daemonAt(4100, { ageS: 7200 });
    const findings = one(d, departed(d, 61 * MINUTE, { slowWaiting: true }));
    expect(findings.daemons.get(4100)?.[0]?.reason).toBe(
      "its last session left 61m ago, and its drain is past daemon.idleExitMinutes (60)",
    );
    expect(drainLeftMs(departed(d, 61 * MINUTE, { slowWaiting: true }), NOW)).toBeNull();
  });

  it("takes a departure before its own start as a predecessor's: the idle rule, not departure", () => {
    const d = daemonAt(4100, { ageS: 7200 });
    const quiet = { usedAt: NOW - 2 * HOUR, activeAt: NOW - 2 * HOUR };
    expect(names(one(d, departed(d, 3 * HOUR, { lastUse: quiet })), 4100)).toEqual(["past-idle"]);
  });

  it("flags past-idle a daemon that never had a consumer, past daemon.idleExitMinutes since its last request", () => {
    const d = daemonAt(4100, { ageS: 2 * 3600 });
    const idle = (ago: number) => workOf(d, { lastUse: { usedAt: NOW, activeAt: NOW - ago } });
    expect(one(d, idle(61 * MINUTE)).daemons.get(4100)).toEqual([
      {
        flag: "past-idle",
        reason: "no consumer, and no request for 61m, past daemon.idleExitMinutes (60)",
        command: `squeal stop ${d.root}`,
      },
    ]);
    expect(names(one(d, idle(59 * MINUTE)), 4100)).toEqual([]);
  });

  it("flags past-unused a daemon with consumers, past daemon.unusedExitMinutes since its last use", () => {
    const d = daemonAt(4100, { ageS: 2 * 3600 });
    const unused = (ago: number) =>
      workOf(d, { consumers: [consumer()], lastUse: { usedAt: NOW - ago, activeAt: NOW } });
    expect(one(d, unused(31 * MINUTE)).daemons.get(4100)?.[0]?.reason).toBe(
      "1 consumer, and no edit, run, wait or request for 31m, past daemon.unusedExitMinutes (30)",
    );
    expect(names(one(d, unused(29 * MINUTE)), 4100)).toEqual([]);
  });

  it("names past-idle or past-unused unknown for a release that records no last use (D9)", () => {
    const d = daemonAt(4100, { ageS: 7200 });
    const why = "its daemon records no last use: a release before D9 (D9)";
    expect(one(d, workOf(d, { lastUse: null })).unknown).toEqual([
      { what: "daemon 4100 flag past-idle", why },
    ]);
    const used = workOf(d, { lastUse: null, consumers: [consumer()] });
    expect(one(d, used).unknown).toEqual([{ what: "daemon 4100 flag past-unused", why }]);
  });
});

describe("dead-consumer", () => {
  const gone = consumer({ alive: false });

  it("flags a consumer whose harness is gone and that a heartbeat between the samples kept", () => {
    const d = daemonAt(4100);
    const first = workOf(d, { consumers: [gone], recordOver: { heartbeatAt: NOW - 4_000 } });
    const second = workOf(d, { consumers: [gone], recordOver: { heartbeatAt: NOW + 1_000 } });
    expect(one(d, first, second).daemons.get(4100)).toEqual([
      {
        flag: "dead-consumer",
        reason:
          "consumer s1: its harness process 3212240 is gone, and the heartbeat between the samples kept it",
        command: null,
      },
    ]);
  });

  it("leaves a consumer gone since the last heartbeat alone, and names another namespace unknown", () => {
    const d = daemonAt(4100);
    expect(names(one(d, workOf(d, { consumers: [gone] })), 4100)).toEqual([]);
    const elsewhere = one(d, workOf(d, { consumers: [consumer({ alive: null })] }));
    expect(elsewhere.unknown).toEqual([
      {
        what: "daemon 4100 flag dead-consumer",
        why: "consumer s1: its harness process 3212240 is in another PID namespace",
      },
    ]);
  });
});

describe("not-installed", () => {
  const testBundle = () =>
    writeAged(join(host.base, "node_modules/.cache/squeal-test/dist/cli/squeal.mjs"));
  const tempRoot = () => {
    const root = join(host.places.tempDir, "squeal-test-repo");
    mkdirSync(join(root, ".git"), { recursive: true });
    return root;
  };

  it("flags a daemon outside every plugin cache, with its root under the temp directory, past 1 h", () => {
    const d = daemonAt(4100, { script: testBundle(), root: tempRoot(), ageS: 2 * 3600 });
    expect(one(d).daemons.get(4100)).toEqual([
      {
        flag: "not-installed",
        reason: `its bundle is in no plugin cache, its root is under ${host.places.tempDir}, and it has run 2h 00m`,
        command: "kill 4100",
      },
    ]);
  });

  it("leaves a test run in its first hour, an installed bundle and a checkout's dist alone", () => {
    expect(
      names(one(daemonAt(4100, { script: testBundle(), root: tempRoot(), ageS: 1800 })), 4100),
    ).toEqual([]);
    expect(names(one(daemonAt(4101, { root: tempRoot(), ageS: 7200 })), 4101)).toEqual([]);
    expect(names(one(daemonAt(4102, { script: testBundle(), ageS: 7200 })), 4102)).toEqual([]);
  });
});
