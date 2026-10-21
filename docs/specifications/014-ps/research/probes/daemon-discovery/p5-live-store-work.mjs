// Throwaway probe P5 (014-01): what a store says about each worktree's daemon
// and work, read through a read-only connection ({ readOnly: true }), never
// through Squeal's openStore (which migrates and may switch the journal mode).
// Usage: node p5-live-store-work.mjs <git-common-dir>...
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const now = Date.now();
const age = (t) => (t == null ? null : Math.round((now - t) / 1000));
const out = { load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0], stores: {} };
for (const common of process.argv.slice(2)) {
  const t0 = performance.now();
  const db = new DatabaseSync(join(common, "squeal", "store.sqlite"), { readOnly: true });
  db.exec("PRAGMA busy_timeout = 100");
  const tOpen = performance.now();
  const userVersion = db.prepare("PRAGMA user_version").get().user_version;
  const meta = (k) => db.prepare("SELECT value FROM meta WHERE key = ?").get(k)?.value ?? null;
  const rows = db.prepare(`SELECT id, root, is_main, daemon_socket, daemon_started_at, daemon_heartbeat_at,
    daemon_heartbeat_interval_ms, daemon_version FROM worktrees`).all();
  const live = rows.filter((w) => w.daemon_socket && now - w.daemon_heartbeat_at < 2 * w.daemon_heartbeat_interval_ms);
  const pend = db.prepare(`SELECT pending, count(*) n FROM test_file_keys WHERE worktree_id = ? AND pending IS NOT NULL GROUP BY pending`);
  const runs = db.prepare(`SELECT id, test_files, checkpoint_id, started_at FROM runs WHERE worktree_id = ? AND ended_at IS NULL`);
  const cps = db.prepare(`SELECT id, kind, started_at FROM checkpoints WHERE worktree_id = ? AND completed_at IS NULL`);
  const cons = db.prepare(`SELECT session_id, agent_id, registered_at, last_seen_at, last_delivered_at FROM consumers WHERE worktree_id = ?`);
  const lastRev = db.prepare(`SELECT max(created_at) t FROM revisions WHERE worktree_id = ?`);
  const tQ = performance.now();
  const detail = live.map((w) => {
    const r = runs.all(w.id);
    return {
      id: w.id, root: w.root.replace(process.env.HOME, "~"), version: w.daemon_version,
      startedAgeS: age(w.daemon_started_at), heartbeatAgeS: age(w.daemon_heartbeat_at),
      pending: Object.fromEntries(pend.all(w.id).map((p) => [p.pending, p.n])),
      openRuns: r.map((x) => ({ files: JSON.parse(x.test_files).length, checkpoint: x.checkpoint_id !== null, ageS: age(x.started_at) })),
      openCheckpoints: cps.all(w.id).map((c) => ({ kind: c.kind, ageS: age(c.started_at) })),
      consumers: cons.all(w.id).length,
      harnesses: Object.keys(JSON.parse(meta(`harness-process:${w.id}`) ?? "{}")).length,
      lastEditAgeS: age(lastRev.get(w.id).t),
      slowTier: meta(`slow-tier:${w.id}`) !== null, stopping: meta(`daemon-exit:${w.id}`) !== null,
      rest: meta(`daemon-rest:${w.id}`) !== null, stopped: meta(`daemon-stopped:${w.id}`) !== null,
    };
  });
  const tEnd = performance.now();
  db.close();
  out.stores[common.replace(process.env.HOME, "~")] = {
    userVersion, worktreeRows: rows.length, liveRecorded: live.length,
    recordedButStale: rows.filter((w) => w.daemon_socket && !live.includes(w)).length,
    ms: { open: +(tOpen - t0).toFixed(1), worktrees: +(tQ - tOpen).toFixed(1), perLiveWorktree: +((tEnd - tQ) / Math.max(1, live.length)).toFixed(1) },
    sample: detail.slice(0, 4), runningTiers: detail.filter((d) => d.openRuns.length > 0).length,
  };
}
console.log(JSON.stringify(out, null, 1));
