// Throwaway (row 005-104). On store COPIES only (copy-tables.mjs): times, as SQL, a registration's
// view write, a delivery's reads of states and view, and a state commit's writes, under three designs:
// the copy (today, and as one INSERT ... SELECT, row 005-103), a non-pass seed with a birth mark
// (`state_born`, AUTOINCREMENT, kept by an AFTER INSERT/DELETE trigger), and copy-on-write (a change
// sequence per state, `state_changed`, and a BEFORE INSERT trigger that copies the old row into the
// views of consumers registered after its last change). The triggers' inserts use the upsert form:
// an outer INSERT OR REPLACE overrides a trigger's own OR IGNORE (trigger-conflict.mjs). Every timed write runs in a transaction that
// is rolled back; the design tables are made once on the copy, committed, and dropped at the end.
// Usage: node measure.mjs <copy.sqlite> <worktree-id> <reps>
import { DatabaseSync } from "node:sqlite";
import { loadavg } from "node:os";
const [file, wt, repsArg] = process.argv.slice(2);
if (!file.includes("/t/4a1288e6/")) throw new Error("copies only");
const REPS = Number(repsArg);
const d = new DatabaseSync(file);
const load = () => loadavg()[0].toFixed(1);
const stats = (xs) => {
  xs.sort((a, b) => a - b);
  return `median ${xs[xs.length >> 1].toFixed(2)} p90 ${xs[Math.floor(xs.length * 0.9)].toFixed(2)} ms`;
};
/** Median of REPS runs of `fn`, each in its own rolled-back write transaction after `setup`. */
const timed = (label, fn, setup = () => {}) => {
  const xs = [];
  for (let i = 0; i < REPS; i++) {
    d.exec("BEGIN IMMEDIATE");
    try {
      setup();
      const t = performance.now();
      fn();
      xs.push(performance.now() - t);
    } finally {
      d.exec("ROLLBACK");
    }
  }
  console.log(`${label}: ${stats(xs)} (load ${load()})`);
};
const one = (sql, ...a) => Object.values(d.prepare(sql).get(...a) ?? { v: null })[0];
const P = "probe-session";
const n = one("SELECT count(*) FROM known_states WHERE worktree_id = ?", wt);
const nonPass = one("SELECT count(*) FROM known_states WHERE worktree_id = ? AND outcome <> 'pass'", wt);
console.log(`worktree ${wt}: ${n} known states, ${nonPass} not pass; load ${load()}`);

// --- design tables, made once (the migration's one-time cost is timed rolled back first) ---
const BORN = `CREATE TABLE state_born (id INTEGER PRIMARY KEY AUTOINCREMENT, worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL, UNIQUE (worktree_id, check_id))`;
const BORN_FILL = "INSERT INTO state_born (worktree_id, check_id) SELECT worktree_id, check_id FROM known_states";
const CHANGED = `CREATE TABLE state_changed (worktree_id TEXT NOT NULL, check_id INTEGER NOT NULL,
  seq INTEGER NOT NULL, PRIMARY KEY (worktree_id, check_id)) WITHOUT ROWID`;
const CHANGED_FILL = "INSERT INTO state_changed SELECT worktree_id, check_id, 0 FROM known_states";
d.exec("DROP TABLE IF EXISTS state_born; DROP TABLE IF EXISTS state_changed");
try { d.exec("DELETE FROM sqlite_sequence WHERE name = 'state_born'"); } catch {}
timed("migration: birth marks of every state of the store", () => { d.exec(BORN); d.exec(BORN_FILL); });
timed("migration: change sequence of every state of the store", () => { d.exec(CHANGED); d.exec(CHANGED_FILL); });
d.exec(`${BORN}; ${BORN_FILL}; ${CHANGED}; ${CHANGED_FILL}`);
d.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('probe-state-seq', '1')");
const mark = () => one("SELECT seq FROM sqlite_sequence WHERE name = 'state_born'");

// --- registration: the view write and the mark ---
const viewIns = d.prepare(`INSERT OR REPLACE INTO consumer_views (worktree_id, session_id, agent_id, check_id,
  outcome, fingerprint, told_at) VALUES (?, ?, 'main', ?, ?, ?, 1)`);
const states = d.prepare(`SELECT s.*, c.project AS check_project, c.test_path AS check_test_path,
  c.kind AS check_kind, c.full_name AS check_full_name FROM known_states s JOIN checks c ON c.id = s.check_id
  WHERE s.worktree_id = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`);
const views = d.prepare(`SELECT v.*, c.project AS check_project, c.test_path AS check_test_path,
  c.kind AS check_kind, c.full_name AS check_full_name FROM consumer_views v JOIN checks c ON c.id = v.check_id
  WHERE v.worktree_id = ? AND v.session_id = ? AND v.agent_id = 'main'
  ORDER BY c.project, c.test_path, c.kind, c.full_name`);
const rows = states.all(wt);
const insCheck = d.prepare("INSERT INTO checks (project, test_path, kind, full_name, templated, first_seen_at) VALUES (?, ?, ?, ?, 0, 1) ON CONFLICT DO NOTHING");
const selCheck = d.prepare("SELECT id FROM checks WHERE project = ? AND test_path = ? AND kind = ? AND full_name = ?");
timed("registration read: known states with checks (every design)", () => states.all(wt));
timed("registration write, copy as now (3 statements per state)", () => {
  for (const r of rows) {
    insCheck.run(r.check_project, r.check_test_path, r.check_kind, r.check_full_name);
    const id = selCheck.get(r.check_project, r.check_test_path, r.check_kind, r.check_full_name).id;
    viewIns.run(wt, P, id, r.outcome, r.fingerprint);
  }
});
const copyAll = d.prepare(`INSERT OR REPLACE INTO consumer_views (worktree_id, session_id, agent_id, check_id, outcome,
  fingerprint, told_at) SELECT worktree_id, ?, 'main', check_id, outcome, fingerprint, 1 FROM known_states WHERE worktree_id = ?`);
timed("registration write, copy as one INSERT ... SELECT (005-103)", () => copyAll.run(P, wt));
const seedNonPass = d.prepare(`INSERT OR REPLACE INTO consumer_views (worktree_id, session_id, agent_id, check_id, outcome,
  fingerprint, told_at) SELECT worktree_id, ?, 'main', check_id, outcome, fingerprint, 1 FROM known_states
  WHERE worktree_id = ? AND outcome <> 'pass'`);
const writeMark = d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
timed("registration write, non-pass seed + birth mark", () => {
  seedNonPass.run(P, wt);
  writeMark.run(`probe-view-mark:${P}`, String(mark()));
});
timed("registration write, copy-on-write: the mark only", () =>
  writeMark.run(`probe-view-mark:${P}`, one("SELECT value FROM meta WHERE key = 'probe-state-seq'")));
const dropView = d.prepare("DELETE FROM consumer_views WHERE worktree_id = ? AND session_id = ? AND agent_id = 'main'");
timed("re-registration: drop the earlier view, a full copy", () => dropView.run(wt, P), () => copyAll.run(P, wt));
timed("re-registration: drop the earlier view, non-pass rows", () => dropView.run(wt, P), () => seedNonPass.run(P, wt));

// --- delivery: what planDelta reads ---
const bornAfter = d.prepare("SELECT check_id FROM state_born WHERE id > ? AND worktree_id = ?");
const statesBorn = d.prepare(`SELECT s.*, b.id AS born, c.project AS check_project, c.test_path AS check_test_path,
  c.kind AS check_kind, c.full_name AS check_full_name FROM known_states s JOIN checks c ON c.id = s.check_id
  LEFT JOIN state_born b ON b.worktree_id = s.worktree_id AND b.check_id = s.check_id
  WHERE s.worktree_id = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`);
const statesChanged = d.prepare(`SELECT s.*, x.seq, c.project AS check_project, c.test_path AS check_test_path,
  c.kind AS check_kind, c.full_name AS check_full_name FROM known_states s JOIN checks c ON c.id = s.check_id
  LEFT JOIN state_changed x ON x.worktree_id = s.worktree_id AND x.check_id = s.check_id
  WHERE s.worktree_id = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`);
timed("delivery read, copy: states + full view", () => { states.all(wt); views.all(wt, P); }, () => copyAll.run(P, wt));
timed("delivery read, birth mark: states + non-pass view + states born after the mark", () => {
  states.all(wt); views.all(wt, P); bornAfter.all(mark(), wt);
}, () => seedNonPass.run(P, wt));
timed("delivery read, birth mark joined per state (alternative)", () => { statesBorn.all(wt); views.all(wt, P); },
  () => seedNonPass.run(P, wt));
timed("delivery read, copy-on-write: states with their change sequence + sparse view", () => {
  statesChanged.all(wt); views.all(wt, P);
}, () => seedNonPass.run(P, wt));

// --- a state commit: K states rewritten (validity only), with each design's triggers ---
const BORN_TRIGGERS = [
  `CREATE TRIGGER probe_born_insert AFTER INSERT ON known_states BEGIN
     INSERT INTO state_born (worktree_id, check_id) VALUES (NEW.worktree_id, NEW.check_id) ON CONFLICT DO NOTHING; END`,
  `CREATE TRIGGER probe_born_delete AFTER DELETE ON known_states BEGIN
     DELETE FROM state_born WHERE worktree_id = OLD.worktree_id AND check_id = OLD.check_id; END`,
];
const COW_TRIGGERS = [
  `CREATE TRIGGER probe_cow_insert BEFORE INSERT ON known_states BEGIN
     INSERT INTO consumer_views (worktree_id, session_id, agent_id, check_id, outcome, fingerprint, told_at)
       SELECT k.worktree_id, k.session_id, k.agent_id, o.check_id, o.outcome, o.fingerprint, 0
       FROM known_states o JOIN state_changed x ON x.worktree_id = o.worktree_id AND x.check_id = o.check_id
       JOIN consumers k ON k.worktree_id = o.worktree_id
       JOIN meta m ON m.key = 'probe-view-mark:' || k.session_id
       WHERE o.worktree_id = NEW.worktree_id AND o.check_id = NEW.check_id AND CAST(m.value AS INTEGER) >= x.seq
       ON CONFLICT DO NOTHING;
     UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'probe-state-seq';
     INSERT INTO state_changed (worktree_id, check_id, seq)
       VALUES (NEW.worktree_id, NEW.check_id, (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'probe-state-seq'))
       ON CONFLICT DO UPDATE SET seq = excluded.seq; END`,
];
const cols = d.prepare("PRAGMA table_info(known_states)").all().map((c) => c.name);
const rewrite = d.prepare(`INSERT OR REPLACE INTO known_states (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
const raw = d.prepare(`SELECT ${cols.join(",")} FROM known_states WHERE worktree_id = ? ORDER BY check_id`).all(wt);
const commit = (k) => () => {
  for (const r of raw.slice(0, k)) rewrite.run(...cols.map((c) => (c === "validity" ? "stale" : r[c])));
};
/** `count` lazy consumers of the worktree, registered after every change (worst case: each first rewrite copies). */
const lazyConsumers = (count) => () => {
  for (let i = 0; i < count; i++) {
    d.prepare("INSERT OR REPLACE INTO consumers (worktree_id, session_id, agent_id, registered_at, last_seen_at) VALUES (?, ?, 'main', 1, 1)").run(wt, `${P}-${i}`);
    writeMark.run(`probe-view-mark:${P}-${i}`, "1000000000");
  }
};
for (const k of [1000, raw.length]) {
  timed(`state commit of ${k} rewritten states, as now (write-marker triggers)`, commit(k));
  timed(`state commit of ${k}, + birth-mark triggers`, commit(k), () => BORN_TRIGGERS.forEach((t) => d.exec(t)));
  for (const c of [1, 8]) {
    timed(`state commit of ${k}, + copy-on-write triggers, ${c} lazy consumer(s), first rewrite of each`, commit(k), () => {
      lazyConsumers(c)();
      COW_TRIGGERS.forEach((t) => d.exec(t));
    });
  }
}
d.exec("DROP TABLE state_born; DROP TABLE state_changed; DELETE FROM sqlite_sequence WHERE name = 'state_born'; DELETE FROM meta WHERE key LIKE 'probe-%'");
console.log(`done; load ${load()}`);
