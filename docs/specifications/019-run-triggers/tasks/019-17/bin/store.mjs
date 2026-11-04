#!/usr/bin/env node
// Throwaway probe for 019-17. Not product code. Runs as squeal-e2e (as-e2e.mjs), read only.
//   node store.mjs <clone> <since epoch ms>
// From <clone>/.git/squeal/store.sqlite: the runs started since <since> (revision, files,
// start, end, end state), the revisions recorded since then (number, trigger, paths), and the
// meta rows of commit reports and Stop holds. One JSON object.
import { DatabaseSync } from "node:sqlite";

const [clone, since0] = process.argv.slice(2);
const since = Number(since0);
const db = new DatabaseSync(`${clone}/.git/squeal/store.sqlite`, { readOnly: true });
const runs = db
  .prepare("SELECT revision, test_files, started_at, ended_at, end_state FROM runs WHERE started_at >= ? ORDER BY started_at")
  .all(since)
  .map((r) => ({
    revision: r.revision,
    files: JSON.parse(r.test_files).map((f) => f.path),
    start: r.started_at,
    end: r.ended_at,
    state: r.end_state,
  }));
const revisions = db
  .prepare("SELECT * FROM revisions WHERE created_at >= ? ORDER BY number")
  .all(since)
  .map((r) => ({ number: r.number, at: r.created_at, trigger: r.trigger, changes: r.changes }));
const meta = db
  .prepare("SELECT key, value FROM meta WHERE key LIKE 'commit%' OR key LIKE 'stop%' OR key LIKE 'turn%'")
  .all();
console.log(JSON.stringify({ runs, revisions, meta }));
