#!/usr/bin/env node
// Row 017-34 probe (throwaway; see README.md). Read-only: it opens the lint
// store and the main store with `readOnly: true` and reads daemon logs.
// It starts no daemon, runs no test, writes only the output JSON it is given.
//
// usage: node stall.mjs <repo common dir, e.g. <repo>/.git> <out.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [commonDir, out] = process.argv.slice(2);
const squeal = join(commonDir, "squeal");
const lint = new DatabaseSync(join(squeal, "lint.sqlite"), { readOnly: true });
const store = new DatabaseSync(join(squeal, "store.sqlite"), { readOnly: true });

// ---- daemon logs: one file per worktree id (its socket's hash) ----------
const LINE = /^(\S+) \[(\d+)\] squeal daemon: (.*)$/;
const REFUSED =
  /^the background ceiling refused a backlog tier: ([\d.]+) busy CPUs, ceiling ([\d.]+) \(([\d.]+) of (\d+) CPUs(?:, (\d+) test slots)?\)/;
const LET = /^the background ceiling let a backlog tier start after (\d+) s and (\d+) refused look/;
const QUIET_MS = 30_000; // SLOT_WAITER_FRESH_MS: a refusal after this much quiet starts a new episode

function readLog(id) {
  let text;
  try {
    text = readFileSync(join(squeal, "logs", `daemon-${id}.log`), "utf8");
  } catch {
    return null;
  }
  const pids = new Map(); // pid -> { start, end, refusals: [{t, busy, ceiling, cpus, slots}], lets: [{t, s, looks}] }
  for (const raw of text.split("\n")) {
    const m = LINE.exec(raw);
    if (m === null) continue;
    const t = Date.parse(m[1]);
    const pid = m[2];
    const msg = m[3];
    let p = pids.get(pid);
    if (p === undefined) pids.set(pid, (p = { pid, start: t, end: t, refusals: [], lets: [] }));
    p.end = t;
    let r;
    if ((r = REFUSED.exec(msg)) !== null) {
      p.refusals.push({ t, busy: +r[1], ceiling: +r[2], cpus: +r[4], slots: r[5] === undefined ? null : +r[5] });
    } else if ((r = LET.exec(msg)) !== null) {
      p.lets.push({ t, s: +r[1], looks: +r[2] });
    }
  }
  return [...pids.values()];
}

/**
 * Refusal episodes of one daemon process. New format (0.1.570+, no "test
 * slots"): one line per episode; a "let" line closes it with its length.
 * Old format: one line per refused look; looks under 30 s apart are one
 * episode. `closed` false: no grant line came (pass stopped asking, daemon
 * ended, or the grant came after 30 s of quiet), so its length is unknown.
 */
function episodes(p) {
  const out = [];
  const looks = [...p.refusals].sort((a, b) => a.t - b.t);
  const lets = [...p.lets].sort((a, b) => a.t - b.t);
  let li = 0;
  let cur = null;
  for (const look of looks) {
    if (look.slots === null && look.cpus !== 4) {
      // new-format episode start: close any previous open one
      if (cur !== null) out.push(cur);
      cur = { format: "new", start: look.t, end: look.t, looks: 1, busy: look.busy, ceiling: look.ceiling, slots: null, closed: false };
      while (li < lets.length && lets[li].t < look.t) li++;
      const next = looks.find((x) => x.t > look.t);
      if (li < lets.length && (next === undefined || lets[li].t <= next.t)) {
        cur.end = lets[li].t;
        cur.looks = lets[li].looks;
        cur.closed = true;
        li++;
      }
      continue;
    }
    if (cur !== null && cur.format === "old" && look.t - cur.end < QUIET_MS) {
      cur.end = look.t;
      cur.looks++;
      cur.minBusy = Math.min(cur.minBusy, look.busy);
      cur.belowCeiling += look.busy < look.ceiling ? 1 : 0;
      continue;
    }
    if (cur !== null) out.push(cur);
    cur = {
      format: "old",
      start: look.t,
      end: look.t,
      looks: 1,
      busy: look.busy,
      minBusy: look.busy,
      ceiling: look.ceiling,
      slots: look.slots,
      belowCeiling: look.busy < look.ceiling ? 1 : 0,
      closed: true,
    };
  }
  if (cur !== null) out.push(cur);
  return out.map((e) => ({ ...e, pid: p.pid }));
}

// ---- lint store ----------------------------------------------------------
const metaOf = (prefix) =>
  new Map(lint.prepare("select key, value from meta where key like ?").all(`${prefix}%`).map((r) => [r.key.slice(prefix.length), r.value]));
const keyings = metaOf("lint-keying:");
const inputs = metaOf("lint-inputs:");
const cpuWaits = metaOf("lint-cpu-wait:");
const roots = new Map(store.prepare("select id, root, daemon_version from worktrees").all().map((r) => [r.id, r]));
const statesOf = lint.prepare("select outcome, count(*) n from states where worktree_id = ? group by outcome");
const timesOf = lint.prepare(
  `select r.linted_at t from states s join results r on r.check_id = s.check_id and r.key = s.judged_key
   where s.worktree_id = ? and r.linted_at >= ? order by r.linted_at`,
);
const revisionOf = store.prepare("select created_at, trigger, changes from revisions where worktree_id = ? and number = ?");

const LOCKFILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json", "bun.lockb"]);
function causeOf(id, k, scopeInputs) {
  if (k.mode === "first") return { cause: "first keying (new worktree or lost cursor)", paths: [] };
  const rev = revisionOf.get(id, k.revision);
  if (rev === undefined) return { cause: "revision not in store", paths: [] };
  const closure = new Set(scopeInputs === null ? [] : JSON.parse(scopeInputs).files.map(([p]) => p));
  const changed = JSON.parse(rev.changes).filter((c) => !c.ignored).map((c) => c.path);
  const hit = (pred) => changed.filter(pred);
  const config = hit((p) => /(^|\/)\.?oxlintrc(\.[a-z]+)?$|(^|\/)oxlint\.config\.[a-z]+$/.test(p));
  if (config.length) return { cause: "oxlint config changed", paths: config, trigger: rev.trigger, changed: changed.length };
  const plug = hit((p) => closure.has(p));
  if (plug.length) return { cause: "config closure file changed (lint rule sources)", paths: plug.slice(0, 5), n: plug.length, trigger: rev.trigger, changed: changed.length };
  const lock = hit((p) => LOCKFILES.has(p.split("/").at(-1)) || p.endsWith("package.json"));
  if (lock.length) return { cause: "lockfile or manifest changed", paths: lock.slice(0, 5), trigger: rev.trigger, changed: changed.length };
  return { cause: "no tracked change at that revision (install, Node, keyed env or closure growth)", paths: changed.slice(0, 5), trigger: rev.trigger, changed: changed.length };
}

const PART_GAP_MS = 1_000; // results one part stores share a time within this
const WAIT_GAP_MS = 10_000; // a gap between parts this long is a wait (rechecks are every 2 s)

const res = [];
for (const [id, v] of keyings) {
  const k = JSON.parse(v);
  const states = Object.fromEntries(statesOf.all(id).map((r) => [r.outcome, r.n]));
  const files = Object.values(states).reduce((a, b) => a + b, 0);
  const times = timesOf.all(id, k.at).map((r) => r.t);
  const parts = [];
  for (const t of times) {
    const last = parts.at(-1);
    if (last !== undefined && t - last.end <= PART_GAP_MS) {
      last.end = t;
      last.n++;
    } else parts.push({ start: t, end: t, n: 1 });
  }
  const linted = times.length;
  const pending = (states.pending ?? 0) + (states.unknown ?? 0);
  const misses = linted + pending;
  const scopeInputs = inputs.get(`${id}:oxlint`) ?? inputs.get(id) ?? null;
  const pids = readLog(id);
  const eps = pids === null ? [] : pids.flatMap(episodes);
  const alive = pids === null ? [] : pids.map((p) => [p.start, p.end]);
  const up = (a, b) => alive.some(([s, e]) => s <= a && e >= b);
  // waits: from the keying to the first part, and between parts
  const gaps = [];
  let prev = k.at;
  for (const p of parts) {
    if (p.start - prev >= WAIT_GAP_MS) gaps.push([prev, p.start]);
    prev = p.end;
  }
  const gapInfo = gaps.map(([a, b]) => {
    const logged = eps.filter((e) => e.start <= b && e.end + QUIET_MS >= a);
    return { a, b, s: (b - a) / 1000, ceilingLogged: logged.length > 0, daemonUp: up(a, b), belowCeilingLooks: logged.reduce((n, e) => n + (e.belowCeiling ?? 0), 0) };
  });
  res.push({
    id,
    root: roots.get(id)?.root ?? null,
    version: roots.get(id)?.daemon_version ?? null,
    keying: k,
    cause: causeOf(id, k, scopeInputs),
    files,
    states,
    linted,
    pending,
    misses,
    parts: parts.length,
    firstPart: parts[0]?.start ?? null,
    lastPart: parts.at(-1)?.end ?? null,
    gaps: gapInfo,
    cpuWait: cpuWaits.has(`${id}:oxlint`) ? JSON.parse(cpuWaits.get(`${id}:oxlint`)) : null,
    log: pids === null ? null : { pids: pids.length, start: Math.min(...pids.map((p) => p.start)), end: Math.max(...pids.map((p) => p.end)) },
    episodes: eps,
  });
}
writeFileSync(out, JSON.stringify(res));
console.log(`worktrees ${res.length}; with a log ${res.filter((r) => r.log !== null).length}`);
