// Throwaway (005-05). q.mjs <fixture> [label]: one line of what the store says now.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
const db = new DatabaseSync(join(process.argv[2], ".git/squeal/store.sqlite"), { readOnly: true });
const w = db.prepare("SELECT daemon_version v, daemon_heartbeat_at h, daemon_started_at s FROM worktrees").get() ?? {};
const runs = db.prepare("SELECT count(*) n FROM runs").get().n;
const files = db.prepare("SELECT count(*) n FROM runs, json_each(runs.test_files)").get().n;
const results = db.prepare("SELECT count(*) n FROM results").get().n;
const uv = db.prepare("PRAGMA user_version").get().user_version;
console.log(`  [${process.argv[3] ?? ""}] schema ${uv}; daemon ${w.v ?? "none"} started ${w.s ? new Date(w.s).toISOString().slice(11, 23) : "-"}` +
  ` heartbeat ${w.h ? Math.round((Date.now() - w.h) / 1000) + "s ago" : "-"}; runs ${runs} (${files} file runs); results ${results}`);
