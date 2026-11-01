#!/usr/bin/env node
// Throwaway probe for 017-13. Not product code. Runs as squeal-e2e, cwd the clone; read only.
//   node store.mjs meta                 lint.sqlite meta rows
//   node store.mjs counts               row counts and states by outcome
//   node store.mjs transitions [after]  transitions with id > after, with path and revision time
//   node store.mjs states <path>...     the states and stored results of these paths
//   node store.mjs revisions [after]    main store revisions with number > after
// Prints JSON lines. Opens <git common dir>/squeal/{lint,store}.sqlite read only.
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const [cmd, ...rest] = process.argv.slice(2);
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
const open = (name) => new DatabaseSync(`${common}/squeal/${name}`, { readOnly: true });
const print = (rows) => {
  for (const r of rows) console.log(JSON.stringify(r));
};
if (cmd === "meta") print(open("lint.sqlite").prepare("SELECT key, value FROM meta").all());
else if (cmd === "counts") {
  const db = open("lint.sqlite");
  for (const t of ["checks", "results", "states", "transitions", "views"])
    print([{ table: t, n: db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n }]);
  print(db.prepare("SELECT outcome, stale, count(*) AS n FROM states GROUP BY outcome, stale").all());
  print(db.prepare("SELECT reason, count(*) AS n FROM states WHERE reason IS NOT NULL GROUP BY reason").all());
} else if (cmd === "transitions") {
  const db = open("lint.sqlite");
  print(
    db
      .prepare(
        "SELECT t.id, c.path, t.kind, t.added, t.removed, t.revision, t.at FROM transitions t JOIN checks c ON c.id = t.check_id WHERE t.id > ? ORDER BY t.id",
      )
      .all(Number(rest[0] ?? 0)),
  );
} else if (cmd === "states") {
  const db = open("lint.sqlite");
  for (const path of rest) {
    const check = db.prepare("SELECT id FROM checks WHERE path = ?").get(path);
    if (!check) {
      print([{ path, check: null }]);
      continue;
    }
    const state = db.prepare("SELECT * FROM states WHERE check_id = ?").all(check.id);
    const results = db
      .prepare("SELECT key, outcome, findings, fingerprint, tool_version, linted_at FROM results WHERE check_id = ? ORDER BY linted_at")
      .all(check.id);
    print([{ path, state, results }]);
  }
} else if (cmd === "cursor") {
  // the revision lint last keyed at, and the main store's latest revision
  const meta = open("lint.sqlite").prepare("SELECT key, value FROM meta WHERE key LIKE 'lint-cursor:%'").all();
  const latest = open("store.sqlite").prepare("SELECT max(number) AS n FROM revisions").get().n;
  print([{ cursor: meta.map((m) => JSON.parse(m.value).revision), latest }]);
} else if (cmd === "list") {
  // list <outcome>: every path in that state, with its reason and whether it is stale
  const db = open("lint.sqlite");
  print(
    db
      .prepare("SELECT c.path, s.outcome, s.stale, s.reason, s.judged_fingerprint FROM states s JOIN checks c ON c.id = s.check_id WHERE s.outcome = ? ORDER BY c.path")
      .all(rest[0] ?? "fail"),
  );
} else if (cmd === "revisions") {
  const db = open("store.sqlite");
  print(
    db
      .prepare("SELECT number, created_at, head, dirty, trigger, changes FROM revisions WHERE number > ? ORDER BY number")
      .all(Number(rest[0] ?? -1)),
  );
} else {
  console.error("usage: store.mjs meta|counts|transitions [after]|states <path>...|revisions [after]");
  process.exit(2);
}
