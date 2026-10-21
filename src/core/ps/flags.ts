import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isNewerVersion } from "../daemon/version.js";
import { isRecord, linkedWorktreeDir } from "../fs/index.js";
import { HEARTBEAT_GRACE_INTERVALS } from "../status/index.js";
import type { AbsolutePath, EpochMs } from "../types/index.js";
import { phaseOn } from "./discover.js";
import { fileFlags, shellQuote } from "./flags-files.js";
import type { DaemonWork, Flag, FoundDaemon, PhaseOf, PsModel } from "./model.js";
import type { PsFlag, PsFlagName, PsOrphan, PsUnknown } from "./shape.js";
import { type ProcessRow, ticksToMs } from "./source.js";

/*
 * Spec 014 D7 (task 014-10): the states that should not be up, each with
 * its reason and the command that would end it, and the two information
 * states that replace a daemon's phase. Every rule reads the model the
 * stages built, the files `lstat` and `readdir` give, and nothing else: no
 * flag runs its command. A rule this source cannot evaluate is named in
 * `unknown` and claims nothing. A rule of one sample reads the second, the
 * latest; `hung` and `orphan-test-process` hold on both.
 */

/** C9: a loser's lock retry is 30 s, an `--await-lock` successor's 120 s, plus 10 s. */
const NO_LOCK_MS = 40_000;
const AWAIT_LOCK_MS = 130_000;
/** C9: a departure grace of 3 s and a check of 5 s at most, so a minute is past any. */
const DEPARTURE_MS = 60_000;
const NOT_INSTALLED_MS = 60 * 60_000;
/** One false orphan showed on a single sample (`research/should-not-be-up.md` 1). */
const ORPHAN_WINDOW_MS = 1_000;
/** C13: the reaper's grace and rounds come well within it. */
const OVERDUE_MS = 60_000;
const NODE_COMMS: ReadonlySet<string> = new Set(["MainThread", "node"]);
const WAITER = /\/dist\/waiter\.mjs$/;
/** `<plugins>/cache/<marketplace>/squeal/<version>/...` of a Claude Code or Codex install. */
const CACHE = /^(.*\/\.(claude|codex)\/plugins)\/cache\/([^/]+)\/squeal\/[^/]+\//;
const NO_LOCKS = "the source has no lock state (D10)";
const NO_MARKS = "the source reads no marks (D10)";
const NO_BOOT = "the boot time cannot be read, so no process has an age";

interface Context {
  readonly model: PsModel;
  readonly phase: PhaseOf;
  readonly ageOf: (row: ProcessRow) => number | null;
  readonly startOf: (row: ProcessRow) => EpochMs | null;
  readonly name: (what: string, why: string) => void;
}

export const flag: Flag = (model) => {
  const unknown: PsUnknown[] = [];
  const named = new Set<string>();
  const name = (what: string, why: string): void => {
    if (named.has(`${what}\n${why}`)) return;
    named.add(`${what}\n${why}`);
    unknown.push({ what, why });
  };
  const { source } = model;
  if (source.locks() === null)
    for (const what of ["flag no-lock", "flag hung", "flag foreign-permit", "phase stopping"])
      name(what, NO_LOCKS);
  if (!source.readsMarks)
    for (const what of ["flag orphan-test-process", "flag overdue-test-process"])
      name(what, NO_MARKS);
  const boot = source.bootTime();
  const ticks = source.clockTicks();
  const startOf = (row: ProcessRow) =>
    boot === null ? null : boot + ticksToMs(row.startTicks, ticks);
  const ageOf = (row: ProcessRow) => {
    const start = startOf(row);
    return start === null ? null : model.now - start;
  };
  const c: Context = { model, phase: phaseOn(source), ageOf, startOf, name };

  const daemons = new Map<number, PsFlag[]>();
  const states = new Map<number, string>();
  const add = (pid: number, flags: readonly PsFlag[]) =>
    daemons.set(pid, [...(daemons.get(pid) ?? []), ...flags]);
  for (const d of model.discovery.daemons) {
    const { flags, state } = daemonFlags(c, d);
    add(d.row.pid, flags);
    if (state !== null) states.set(d.row.pid, state);
  }
  for (const [pid, flags] of duplicates(c)) add(pid, flags);

  const files = fileFlags(model);
  return {
    daemons,
    states,
    processes: overdue(c),
    orphans: orphans(c),
    files: files.files,
    unflagged: files.unflagged,
    leftovers: files.leftovers,
    unknown: [...unknown, ...files.unknown],
  };
};

/**
 * While `work` drains (D7 `draining`, task 004-29): the time left until
 * `daemon.idleExitMinutes` after its own last departure; `null` otherwise.
 * A drain runs for slow work or an open checkpoint (task 001-219).
 */
export function drainLeftMs(work: DaemonWork | null, now: EpochMs): number | null {
  const departed = ownDeparture(work);
  if (work === null || departed === null) return null;
  if (work.slowWaiting !== true && work.checkpoints.length === 0) return null;
  const left = departed + work.settings.idleExitMinutes * 60_000 - now;
  return left > 0 ? left : null;
}

/** The departure after the daemon's own start, while no consumer is registered. */
function ownDeparture(work: DaemonWork | null): EpochMs | null {
  if (work?.record == null || work.consumers.length > 0 || work.departedAt === null) return null;
  return work.departedAt >= work.record.startedAt ? work.departedAt : null;
}

function daemonFlags(c: Context, d: FoundDaemon): { flags: PsFlag[]; state: string | null } {
  const { model } = c;
  const pid = d.row.pid;
  const work = model.second.work.get(pid) ?? model.first.work.get(pid) ?? null;
  const phase = c.phase(d, work, model.now);
  const flags: PsFlag[] = [];
  const add = (flag: PsFlagName, reason: string, command: string | null) =>
    flags.push({ flag, reason, command });
  const kill = `kill ${pid}`;
  const stop = d.root === null ? kill : `squeal stop ${shellQuote(d.root)}`;
  let state: string | null = null;

  if (d.root === null) c.name(`daemon ${pid} flag root-gone`, "its root argument is relative");
  else {
    const gone = rootGone(d.root);
    if (gone !== null) add("root-gone", gone, kill);
  }
  const bundle = bundleOf(d.script);
  if (!existsSync(bundle)) add("install-gone", `its bundle ${bundle} is missing`, stop);
  const older = olderOf(c, d, work);
  if (typeof older === "string") state = older;
  else if (older !== null) add("older", older.reason, stop);

  const age = c.ageOf(d.row);
  if (phase === "waiting") {
    const bound = d.awaitLock ? AWAIT_LOCK_MS : NO_LOCK_MS;
    if (age === null) c.name(`daemon ${pid} flag no-lock`, NO_BOOT);
    else if (age > bound)
      add("no-lock", `it has waited ${duration(age)} for its lock, past ${bound / 1000} s`, kill);
  }
  const hung = hungOf(c, d);
  if (hung !== null) add("hung", hung, `kill ${pid}; sleep 5; kill -9 ${pid}`);
  if (phase === "serving" && work?.record != null) {
    const life = lifeOf(c, pid, work, work.record.heartbeatIntervalMs);
    if (life.flag !== null) add(life.flag.flag, life.flag.reason, stop);
    state = life.state ?? state;
  }
  for (const reason of deadConsumers(c, pid)) add("dead-consumer", reason, null);

  const home = model.places.home;
  const installed =
    (d.harness !== null && within(d.script, home)) || within(d.script, join(home, ".local"));
  if (!installed && d.root !== null && within(d.root, model.places.tempDir)) {
    if (age === null) c.name(`daemon ${pid} flag not-installed`, NO_BOOT);
    else if (age > NOT_INSTALLED_MS)
      add(
        "not-installed",
        `its bundle is in no plugin cache, its root is under ${model.places.tempDir}, and it has run ${duration(age)}`,
        kill,
      );
  }
  return { flags, state };
}

/** C9 `root-removed` and `worktree-removed`, as the daemon's own check reads them. */
function rootGone(root: AbsolutePath): string | null {
  if (!existsSync(root)) return `its root ${root} is missing`;
  let linked: AbsolutePath | null;
  try {
    linked = linkedWorktreeDir(root);
  } catch {
    // An unreadable `.git` file: its daemon's own check decides, not this one.
    return null;
  }
  return linked !== null && !existsSync(linked)
    ? `the gitdir ${linked} its .git names is missing`
    : null;
}

/** `.../squeal/<version>/dist` of `.../dist/cli/squeal.mjs`: the bundle its arguments name. */
function bundleOf(script: string): string {
  const at = script.lastIndexOf("/dist/");
  return at < 0 ? script : script.slice(0, at + "/dist".length);
}

/**
 * D7 `older`: a version older than the one its harness installs now, read
 * from the install its own script lies in. The information state instead,
 * while a consumer of an older version, or of none, has a live harness: C9
 * asks no step-down then (`stepDownIfOlder`). `null` when it is not older,
 * or cannot be told.
 */
function olderOf(
  c: Context,
  d: FoundDaemon,
  work: DaemonWork | null,
): { readonly reason: string } | string | null {
  const m = CACHE.exec(d.script);
  if (m === null || d.version === null) return null;
  const [, plugins = "", harness = "", marketplace = ""] = m;
  const newest =
    harness === "claude"
      ? claudeInstalled(plugins, marketplace, d.root)
      : codexNewest(plugins, marketplace);
  if (newest === null) {
    c.name(
      `daemon ${d.row.pid} flag older`,
      `no installed ${harness} version can be read under ${plugins}`,
    );
    return null;
  }
  if (!isNewerVersion(newest, d.version)) return null;
  const old = (work?.consumers ?? []).filter(
    (x) => x.version === null || isNewerVersion(newest, x.version),
  );
  const holder = old.find((x) => x.alive === true);
  if (holder?.harness != null) return `older (session ${holder.harness.pid} holds it)`;
  if (old.some((x) => x.alive === null && x.harness !== null)) {
    const why =
      "a consumer of an older version has a harness process this PID namespace cannot see";
    c.name(`daemon ${d.row.pid} flag older`, why);
    return null;
  }
  return { reason: `version ${d.version}; ${harness} installs ${newest}` };
}

/** The user-scope entry, or the project one of `root`, as a session there loads it. */
function claudeInstalled(
  plugins: string,
  marketplace: string,
  root: AbsolutePath | null,
): string | null {
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(join(plugins, "installed_plugins.json"), "utf8"));
  } catch {
    return null;
  }
  const entries =
    isRecord(file) && isRecord(file.plugins) ? file.plugins[`squeal@${marketplace}`] : null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isRecord(entry) || typeof entry.version !== "string") continue;
    if (entry.scope === "user" || (entry.scope === "project" && entry.projectPath === root))
      return entry.version;
  }
  return null;
}

/** The newest version directory beside its own. */
function codexNewest(plugins: string, marketplace: string): string | null {
  let versions: string[];
  try {
    versions = readdirSync(join(plugins, "cache", marketplace, "squeal"));
  } catch {
    return null;
  }
  let newest: string | null = null;
  for (const v of versions) if (newest === null || isNewerVersion(v, newest)) newest = v;
  return newest !== null && /^\d+\.\d+\.\d+$/.test(newest) ? newest : null;
}

/** D7 `hung`: serving, with a heartbeat past two intervals, on both readings. */
function hungOf(c: Context, d: FoundDaemon): string | null {
  const { model } = c;
  let age = 0;
  for (const reading of [model.first, model.second]) {
    const work = reading.work.get(d.row.pid) ?? null;
    const record = work?.record;
    if (record == null || c.phase(d, work, model.now) !== "serving") return null;
    const bound = HEARTBEAT_GRACE_INTERVALS * record.heartbeatIntervalMs;
    age = model.now - record.heartbeatAt;
    if (age <= bound) return null;
  }
  return `its heartbeat is ${duration(age)} old on both samples, past two intervals`;
}

/**
 * D7 `past-departure`, `past-idle`, `past-unused` and `draining`, by the
 * daemon's own exit rules (`lifecycle.ts`): idle from its last activity,
 * unused from its last use (D9), each a heartbeat grace past its bound,
 * since the daemon checks every few seconds and records its use with the
 * heartbeat. A drain past its bound is past its departure too.
 */
function lifeOf(
  c: Context,
  pid: number,
  work: DaemonWork,
  intervalMs: number,
): { flag: { flag: PsFlagName; reason: string } | null; state: string | null } {
  const now = c.model.now;
  const grace = HEARTBEAT_GRACE_INTERVALS * intervalMs;
  const idleMs = work.settings.idleExitMinutes * 60_000;
  const unusedMs = work.settings.unusedExitMinutes * 60_000;
  const none = { flag: null, state: null };
  const departed = ownDeparture(work);
  if (departed !== null) {
    const since = now - departed;
    const left = drainLeftMs(work, now);
    if (left !== null) return { flag: null, state: `draining ${Math.ceil(left / 60_000)}m left` };
    const drains = work.slowWaiting === true || work.checkpoints.length > 0;
    if (!drains && work.slowWaiting === null) {
      c.name(`daemon ${pid} flag past-departure`, "its slow-tier row cannot be read");
      return none;
    }
    if (drains && since > idleMs + grace) {
      const reason = `its last session left ${duration(since)} ago, and its drain is past daemon.idleExitMinutes (${work.settings.idleExitMinutes})`;
      return { flag: { flag: "past-departure", reason }, state: null };
    }
    if (!drains && since > DEPARTURE_MS) {
      const reason = `its last session left ${duration(since)} ago, and no slow work is left`;
      return { flag: { flag: "past-departure", reason }, state: null };
    }
    return none;
  }
  const consumers = work.consumers.length;
  const rule = consumers === 0 ? "past-idle" : "past-unused";
  if (work.lastUse === null) {
    c.name(
      `daemon ${pid} flag ${rule}`,
      "its daemon records no last use: a release before D9 (D9)",
    );
    return none;
  }
  if (consumers === 0) {
    const quiet = now - work.lastUse.activeAt;
    if (quiet <= idleMs + grace) return none;
    const reason = `no consumer, and no request for ${duration(quiet)}, past daemon.idleExitMinutes (${work.settings.idleExitMinutes})`;
    return { flag: { flag: "past-idle", reason }, state: null };
  }
  const quiet = now - work.lastUse.usedAt;
  if (quiet <= unusedMs + grace) return none;
  const reason = `${consumers === 1 ? "1 consumer" : `${consumers} consumers`}, and no edit, run, wait or request for ${duration(quiet)}, past daemon.unusedExitMinutes (${work.settings.unusedExitMinutes})`;
  return { flag: { flag: "past-unused", reason }, state: null };
}

/**
 * D7 `dead-consumer`: a consumer whose harness process is gone on both
 * readings, kept past a heartbeat between them. Each heartbeat drops such a
 * consumer first (`dropGoneHarnesses`), and the store keeps no time of
 * death, so a consumer gone since the last heartbeat is the healthy case.
 */
function deadConsumers(c: Context, pid: number): string[] {
  const first = c.model.first.work.get(pid) ?? null;
  const second = c.model.second.work.get(pid) ?? null;
  if (first?.record == null || second?.record == null) return [];
  const beat = second.record.heartbeatAt > first.record.heartbeatAt;
  const reasons: string[] = [];
  for (const x of second.consumers) {
    if (x.harness === null) continue;
    if (x.alive === null) {
      const why = `consumer ${x.sessionId}: its harness process ${x.harness.pid} is in another PID namespace`;
      c.name(`daemon ${pid} flag dead-consumer`, why);
      continue;
    }
    const before = first.consumers.find(
      (y) => y.sessionId === x.sessionId && y.agentId === x.agentId,
    );
    if (x.alive || before?.alive !== false || !beat) continue;
    reasons.push(
      `consumer ${x.sessionId}: its harness process ${x.harness.pid} is gone, and the heartbeat between the samples kept it`,
    );
  }
  return reasons;
}

/**
 * D7 `duplicate`: two daemon processes of one root, flagged on the one
 * without the lock once its wait is past the `no-lock` bound. Where the
 * holder cannot be told, each is flagged once all have waited so long, and
 * its command names every pid (D10).
 */
function duplicates(c: Context): Map<number, PsFlag[]> {
  const byRoot = new Map<AbsolutePath, FoundDaemon[]>();
  for (const d of c.model.discovery.daemons)
    if (d.root !== null) byRoot.set(d.root, [...(byRoot.get(d.root) ?? []), d]);
  const out = new Map<number, PsFlag[]>();
  for (const [root, group] of byRoot) {
    if (group.length < 2) continue;
    const waited = (d: FoundDaemon) => {
      const age = c.ageOf(d.row);
      if (age === null) c.name(`daemon ${d.row.pid} flag duplicate`, NO_BOOT);
      return age !== null && age > (d.awaitLock ? AWAIT_LOCK_MS : NO_LOCK_MS);
    };
    const holders = group.filter((d) => d.holdsLock === true);
    const known = group.every((d) => d.holdsLock !== null);
    const others = (d: FoundDaemon) => group.filter((o) => o !== d).map((o) => o.row.pid);
    if (known && holders.length === 1) {
      const holder = holders[0]?.row.pid;
      for (const d of group) {
        if (d.holdsLock || !waited(d)) continue;
        const reason = `daemon ${holder} holds the lock of its root ${root}`;
        out.set(d.row.pid, [{ flag: "duplicate", reason, command: `kill ${d.row.pid}` }]);
      }
    } else if (group.every(waited)) {
      for (const d of group) {
        const reason = `daemon ${others(d).join(", ")} has its root ${root} too; which holds the lock is unknown`;
        const command = `kill ${d.row.pid}  # or ${others(d).join(", ")}: whichever holds no lock`;
        out.set(d.row.pid, [{ flag: "duplicate", reason, command }]);
      }
    }
  }
  return out;
}

/**
 * D7 `overdue-test-process`: a process carrying a mark, not its daemon's
 * own child, older than `runner.timeoutMs` plus a minute. The flag sits on
 * the test process whose row lists it, a descendant included.
 */
function overdue(c: Context): Map<number, PsFlag[]> {
  const { model } = c;
  const out = new Map<number, PsFlag[]>();
  if (!model.source.readsMarks) return out;
  const table = model.second.sample.table;
  for (const p of model.second.attribution.processes) {
    const work = model.second.work.get(p.daemonPid) ?? model.first.work.get(p.daemonPid);
    if (work === undefined || !Number.isFinite(work.settings.timeoutMs)) continue;
    const bound = work.settings.timeoutMs + OVERDUE_MS;
    for (const pid of [p.pid, ...p.descendants]) {
      const row = table.get(pid);
      if (row === undefined || row.ppid === p.daemonPid) continue;
      const age = c.ageOf(row);
      if (age === null) c.name("flag overdue-test-process", NO_BOOT);
      if (age === null || age <= bound) continue;
      if (pid !== p.pid && model.source.markOf(pid) === null) continue;
      const who =
        pid === p.pid
          ? "it is"
          : `its descendant ${pid} (${row.comm}) carries its mark, is not its daemon's child, and is`;
      const reason = `${who} ${duration(age)} old, past runner.timeoutMs plus ${OVERDUE_MS / 1000} s`;
      out.set(p.pid, [
        ...(out.get(p.pid) ?? []),
        { flag: "overdue-test-process", reason, command: `kill ${pid}` },
      ]);
    }
  }
  return out;
}

/** D7's flagged processes no live daemon owns: `orphan-test-process`, `orphan-waiter`, `foreign-permit`. */
function orphans(c: Context): PsOrphan[] {
  const { model } = c;
  const table = model.second.sample.table;
  const byPid = new Map<number, PsFlag[]>();
  const add = (pid: number, flag: PsFlagName, reason: string) =>
    byPid.set(pid, [...(byPid.get(pid) ?? []), { flag, reason, command: `kill ${pid}` }]);

  for (const { pid, reason } of orphanTestProcesses(c)) add(pid, "orphan-test-process", reason);
  for (const row of table.values()) {
    if (!NODE_COMMS.has(row.comm) || (row.uid !== null && row.uid !== model.places.uid)) continue;
    if (!(model.source.cmdline(row.pid) ?? []).some((a) => WAITER.test(a))) continue;
    const parent = table.get(row.ppid);
    if (parent === undefined) add(row.pid, "orphan-waiter", `its parent ${row.ppid} is gone`);
    else if (row.ppid === 1 || parent.comm === "systemd")
      add(
        row.pid,
        "orphan-waiter",
        `its parent is ${parent.comm} ${row.ppid}: its session is gone`,
      );
  }
  for (const { pid, path } of model.pool.foreign)
    if (table.has(pid) || model.first.sample.table.has(pid))
      add(pid, "foreign-permit", `it holds the pool permit ${path} and is no daemon`);

  return [...byPid].map(([pid, flags]) => {
    const row = table.get(pid) ?? model.first.sample.table.get(pid);
    return {
      pid,
      comm: row?.comm ?? "",
      startedAt: row === undefined ? null : c.startOf(row),
      flags,
    };
  });
}

/**
 * D7 `orphan-test-process`: a mark no live daemon's token owns, on both
 * readings at least a second apart, by the same process. While any
 * daemon's token is unread, a mark may be its, so none is claimed.
 */
function orphanTestProcesses(c: Context): { pid: number; reason: string }[] {
  const { model } = c;
  if (!model.source.readsMarks) return [];
  for (const d of model.discovery.daemons) {
    const pid = d.row.pid;
    if ([model.first, model.second].some((r) => (r.work.get(pid)?.token ?? null) === null)) {
      c.name(
        "flag orphan-test-process",
        `the token of daemon ${pid} is unread, so a mark may be its`,
      );
      return [];
    }
  }
  const windowMs = model.second.sample.atMs - model.first.sample.atMs;
  if (windowMs < ORPHAN_WINDOW_MS) {
    c.name(
      "flag orphan-test-process",
      `the samples are ${Math.round(windowMs)} ms apart, under 1 s`,
    );
    return [];
  }
  const before = new Map(model.first.attribution.unowned.map((u) => [u.pid, u.mark]));
  const found: { pid: number; reason: string }[] = [];
  for (const { pid, mark } of model.second.attribution.unowned) {
    const a = model.first.sample.table.get(pid);
    const b = model.second.sample.table.get(pid);
    if (before.get(pid) !== mark || a === undefined || a.startTicks !== b?.startTicks) continue;
    const token = mark.split(":")[0];
    found.push({ pid, reason: `its mark's token ${token} names no live daemon, on both samples` });
  }
  return found;
}

function within(path: string, dir: string): boolean {
  return path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

/** `45 s`, `12m`, `3h 05m`. */
function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 120) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 120) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
