// Row 005-105 probe (throwaway, kept as evidence): the one-time fill of birth marks on a store
// at the released schema with 1,000,000 synthetic states, and the daemon's state commit (the
// repository's `upsertMany`, every state rewritten) on 32,000 states with no birth-mark triggers,
// with the upsert form (`ON CONFLICT DO NOTHING`), the `WHERE NOT EXISTS` form and both, the
// write-marker triggers present as under a daemon of this release.
// Writes only under the directory it is given. Usage:
//   node_modules/.bin/tsx docs/specifications/005-agent-adoption/tasks/005-105/measure.ts <scratch-dir> [rounds]
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { isStoreOpenFailure, openStore } from "../../../../../src/core/store/open.js";
import { currentBirthMark, ensureBirthMarks } from "../../../../../src/core/store/state-born.js";
import { connectionOf } from "../../../../../src/core/store/store.js";
import { ensureWriteMarkers } from "../../../../../src/core/store/write-markers.js";
import type { KnownState } from "../../../../../src/core/types/state.js";
import type { Store } from "../../../../../src/core/types/store.js";

const [scratch, roundsArg] = process.argv.slice(2);
if (scratch === undefined) throw new Error("usage: measure.ts <scratch-dir> [rounds]");
const rounds = Number(roundsArg ?? 9);
const load = () => loadavg()[0]?.toFixed(1);

function storeAt(name: string): Store {
  const commonDir = mkdtempSync(join(scratch, `${name}-`));
  mkdirSync(commonDir, { recursive: true });
  writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
  const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  return store;
}

const ms = (fn: () => void) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
const p90 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.9) - 1] ?? NaN;

// --- 1. the fill: 30 worktrees x 33,334 checks = 1,000,020 states, written by SQL as a release does
{
  const fills: number[] = [];
  for (let r = 0; r < Math.min(rounds, 5); r++) {
    const store = storeAt("fill");
    const conn = connectionOf(store);
    conn.transaction(() => {
      conn.run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 33334)
        INSERT INTO checks (kind, project, test_path, full_name, templated, first_seen_at)
        SELECT 'test', '', 'src/t' || (i % 500) || '.test.ts', 'case ' || i, 0, 1 FROM n`);
      conn.run(`WITH RECURSIVE w(j) AS (SELECT 1 UNION ALL SELECT j + 1 FROM w WHERE j < 30)
        INSERT INTO known_states (worktree_id, check_id, outcome, validity)
        SELECT 'wt-' || j, c.id, 'pass', 'current' FROM w, checks c`);
    });
    const states = Number(conn.get("SELECT count(*) AS n FROM known_states")?.n);
    fills.push(ms(() => ensureBirthMarks(store)));
    if (currentBirthMark(store) !== states) throw new Error("fill missed states");
    console.log(`fill round ${r + 1}: ${states} states, ${fills.at(-1)?.toFixed(0)} ms, load ${load()}`);
    store.close();
  }
  console.log(`fill: median ${median(fills).toFixed(0)} ms, max ${Math.max(...fills).toFixed(0)} ms`);
}

// --- 2. the state commit: every one of 32,000 states rewritten through `upsertMany`
{
  const store = storeAt("commit");
  const conn = connectionOf(store);
  const state = (i: number): KnownState => ({
    worktreeId: "wt-1",
    check: { kind: "test", project: "", testPath: `src/t${i % 400}.test.ts`, fullName: `case ${i}` },
    outcome: i % 1000 === 0 ? "fail" : "pass",
    validity: "current",
    pendingPhase: null,
    observedAt: 1,
    commit: null,
    origin: { kind: "own" },
    durationMs: 3,
    location: null,
    summary: null,
    fingerprint: i % 1000 === 0 ? `Error: ${i}` : null,
  });
  const states = Array.from({ length: 32_000 }, (_, i) => state(i));
  store.knownStates.upsertMany(states);
  // As a daemon of this release registers: the write markers, then the birth marks.
  ensureWriteMarkers(store);
  ensureBirthMarks(store);
  const INSERT = "squeal_born_known_states_insert";
  const forms: Record<string, string | null> = {
    "no triggers": null,
    "ON CONFLICT DO NOTHING": `INSERT INTO state_born (worktree_id, check_id) VALUES (NEW.worktree_id, NEW.check_id) ON CONFLICT DO NOTHING`,
    "WHERE NOT EXISTS": `INSERT INTO state_born (worktree_id, check_id) SELECT NEW.worktree_id, NEW.check_id
      WHERE NOT EXISTS (SELECT 1 FROM state_born WHERE worktree_id = NEW.worktree_id AND check_id = NEW.check_id)`,
    "WHERE NOT EXISTS + ON CONFLICT DO NOTHING": `INSERT INTO state_born (worktree_id, check_id) SELECT NEW.worktree_id, NEW.check_id
      WHERE NOT EXISTS (SELECT 1 FROM state_born WHERE worktree_id = NEW.worktree_id AND check_id = NEW.check_id)
      ON CONFLICT DO NOTHING`,
  };
  const times: Record<string, number[]> = Object.fromEntries(Object.keys(forms).map((k) => [k, []]));
  const loads: string[] = [];
  for (let r = 0; r < rounds; r++) {
    for (const [name, body] of Object.entries(forms)) {
      conn.db.exec(`DROP TRIGGER IF EXISTS ${INSERT}; DROP TRIGGER IF EXISTS squeal_born_known_states_delete`);
      if (body !== null) {
        conn.db.exec(`CREATE TRIGGER ${INSERT} AFTER INSERT ON known_states BEGIN ${body}; END`);
        conn.db.exec(`CREATE TRIGGER squeal_born_known_states_delete AFTER DELETE ON known_states BEGIN
          DELETE FROM state_born WHERE worktree_id = OLD.worktree_id AND check_id = OLD.check_id; END`);
      }
      const seq = () => Number(conn.get("SELECT seq FROM sqlite_sequence WHERE name = 'state_born'")?.seq);
      const before = seq();
      times[name]?.push(ms(() => store.knownStates.upsertMany(states)));
      if (r === 0) console.log(`${name}: high mark ${before} -> ${seq()} over one rewrite`);
    }
    loads.push(load() ?? "?");
  }
  for (const [name, xs] of Object.entries(times)) {
    console.log(`commit, 32,000 states rewritten, ${name}: median ${median(xs).toFixed(1)} ms, p90 ${p90(xs).toFixed(1)} ms`);
  }
  console.log(`loads per round: ${loads.join(", ")}`);
  store.close();
}
