// Row 021-38 probe: a recount's switch transaction (staged count, adopt, removed delete, commit)
// on a code store shaped like chain-load's recount: 1,263 files of 10 functions, half renamed.
// Usage: tsx switch-probe.mts <src root> <index: none|full|partial|narrow|wtnarrow> <cache_size or ""> <variant: base|noblob|ids|cxids>
// The store's base indexes are those of <src root>'s CODE_INDEXES; the blob index is the probe's own.
// NOCKPT=1 turns off the WAL auto-checkpoint. Writes only a new directory under the temp dir.
import { createHash } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const [srcRoot = "src", index = "full", cache = "", variant = "base"] = process.argv.slice(2);
const { CODE_INDEXES, CODE_MIGRATIONS } = await import(
  pathToFileURL(join(srcRoot, "core/code/store/schema.ts")).href
);
const FILES = 1263;
const FNS = 10;

const dir = mkdtempSync(join(tmpdir(), "p38-"));
const db = new DatabaseSync(join(dir, "code.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL");
if (cache) db.exec(`PRAGMA cache_size = ${cache}`);
if (process.env.NOCKPT) db.exec("PRAGMA wal_autocheckpoint = 0");
CODE_MIGRATIONS[0]!(db as never);
for (const [name, sql] of Object.entries(CODE_INDEXES) as [string, string][]) {
  if (!name.includes("blob")) db.exec(sql);
}
if (index === "full") db.exec("CREATE INDEX states_by_blob ON states (blob)");
if (index === "narrow") db.exec("CREATE INDEX states_by_blob ON states (substr(blob, 1, 8)) WHERE measure = 'complexity'");
if (index === "wtnarrow") db.exec("CREATE INDEX states_by_blob ON states (worktree_id, substr(blob, 1, 8)) WHERE measure = 'complexity'");
if (index === "partial") db.exec("CREATE INDEX states_by_blob ON states (blob) WHERE measure = 'complexity'");

const blob = (f: number) => createHash("sha1").update(`f${f}`).digest("hex");
const WT = "wt-a";
const STAGED = "wt-a\0staged";
db.exec("BEGIN");
const chk = db.prepare("INSERT INTO checks (path, qualified_name, occurrence) VALUES (?, ?, 0)");
const st = db.prepare(
  `INSERT INTO states (worktree_id, check_id, measure, outcome, value, threshold, counted_at, blob, changed_at)
   VALUES (?, ?, ?, ?, 1, 20, 1, ?, 1)`,
);
let id = 0;
const ids: number[][] = [];
for (let f = 0; f < FILES; f++) {
  const row: number[] = [];
  for (let n = 0; n < FNS; n++) {
    chk.run(`src/m${f}.ts`, `f${n}`);
    row.push(++id);
    for (const m of ["complexity", "crap", "uncovered"]) {
      st.run(WT, id, m, m === "complexity" ? "pass" : "fail", blob(f));
    }
  }
  for (let n = 0; n < FNS / 2; n++) {
    chk.run(`src/m${f}.ts`, `g${n}`);
    row.push(++id);
  }
  ids.push(row);
}
db.exec("COMMIT");
db.exec("BEGIN");
// Staged: g0..g4 and f5..f9 of each file.
for (let f = 0; f < FILES; f++) {
  const row = ids[f]!;
  for (const n of [10, 11, 12, 13, 14, 5, 6, 7, 8, 9]) st.run(STAGED, row[n]!, "complexity", "pass", blob(f));
}
db.exec("COMMIT");
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
const removed = ids.flatMap((row, f) =>
  [0, 1, 2, 3, 4].map((n) => [`src/m${f}.ts`, `f${n}`, 0]),
);

const t = (label: string, fn: () => void) => {
  const a = performance.now();
  fn();
  const ms = performance.now() - a;
  out.push(`${label} ${ms.toFixed(1)}`);
  return ms;
};
const out: string[] = [];
const blobSet = variant === "noblob" ? "" : "blob = excluded.blob,";
const total = performance.now();
db.exec("BEGIN IMMEDIATE");
t("count", () => db.prepare("SELECT count(*) AS n FROM states WHERE worktree_id = ? AND measure = ?").get(STAGED, "complexity"));
t("adopt", () =>
  db
    .prepare(
      `INSERT INTO states (worktree_id, check_id, measure, outcome, value, threshold,
         counted_at, blob, changed_at, edited_revision, edited_at)
       SELECT ?, check_id, measure, outcome, value, threshold, counted_at, blob, changed_at,
         edited_revision, edited_at
       FROM states WHERE worktree_id = ? AND measure = ?
       ON CONFLICT (worktree_id, check_id, measure) DO UPDATE SET
         outcome = excluded.outcome, value = excluded.value, threshold = excluded.threshold,
         counted_at = excluded.counted_at, ${blobSet}
         changed_at = excluded.changed_at,
         edited_revision = coalesce(excluded.edited_revision, states.edited_revision),
         edited_at = coalesce(excluded.edited_at, states.edited_at)`,
    )
    .run(WT, STAGED, "complexity"),
);
if (variant === "cxids") {
  t("removed", () =>
    db
      .prepare(
        `DELETE FROM states WHERE worktree_id = ? AND check_id IN (SELECT value FROM json_each(?)) AND measure = 'complexity'`,
      )
      .run(WT, JSON.stringify(ids.flatMap((row) => row.slice(0, 5)))),
  );
} else if (variant === "ids") {
  t("removed", () =>
    db
      .prepare(
        `DELETE FROM states WHERE worktree_id = ? AND check_id IN (SELECT value FROM json_each(?))`,
      )
      .run(WT, JSON.stringify(ids.flatMap((row) => row.slice(0, 5)))),
  );
} else {
  t("removed", () =>
    db
      .prepare(
        `DELETE FROM states WHERE worktree_id = ? AND check_id IN (
           SELECT c.id FROM json_each(?) j JOIN checks c ON c.path = j.value ->> 0
             AND c.qualified_name = j.value ->> 1 AND c.occurrence = j.value ->> 2)`,
      )
      .run(WT, JSON.stringify(removed)),
  );
}
t("commit", () => db.exec("COMMIT"));
out.push(`total ${(performance.now() - total).toFixed(1)}`);
out.push(`walKiB ${Math.round(statSync(join(dir, "code.sqlite-wal")).size / 1024)}`);
const a = performance.now();
db.prepare("DELETE FROM states WHERE worktree_id = ? AND measure = ?").run(STAGED, "complexity");
out.push(`dropStaged ${(performance.now() - a).toFixed(1)}`);
console.log(`${index} cache=${cache || "default"} ${variant}: ${out.join(", ")}`);
