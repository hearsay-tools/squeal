// THROWAWAY probe (011-64 design, question 2). Over every stored failure of a read-only store
// copy: where `location` points (the check's own test file, another project file, none), and
// whether the stored, relativized `stack` text holds a frame in the check's own test file, and
// whether that text's positions are the source-mapped ones `location` came from.
// Usage: STORE=<copy.sqlite> node frames.mjs
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.env.STORE ?? "/tmp/t64/cezar-store.sqlite", { readOnly: true });
const rows = db
  .prepare(
    `SELECT DISTINCT c.project, c.test_path, c.kind, r.failure_id, f.errors
     FROM results r JOIN checks c ON c.id = r.check_id JOIN failure_texts f ON f.id = r.failure_id
     WHERE r.outcome = 'fail'`,
  )
  .all();

// A root-relative position as `relativizeText` leaves it: `path/to/file.ts:12:3`, never absolute.
const POSITION = /(?:^|[\s(@])((?!\/)[^\s():'"]+\.(?:[cm]?[jt]sx?|py)):(\d+)(?::(\d+))?/gm;
const positions = (text) =>
  [...(text ?? "").matchAll(POSITION)]
    .map((m) => ({ path: m[1], line: Number(m[2]), column: m[3] === undefined ? null : Number(m[3]) }))
    .filter((p) => !p.path.includes("node_modules/"));

const count = new Map();
const bump = (k) => count.set(k, (count.get(k) ?? 0) + 1);
const examples = [];
for (const row of rows) {
  const errors = JSON.parse(row.errors);
  const first = errors[0];
  const project = row.project;
  bump(`all`);
  bump(`project ${project}`);
  if (first === undefined) {
    bump("no error");
    continue;
  }
  const loc = first.location;
  const frames = positions(first.stack);
  const own = frames.find((p) => p.path === row.test_path);
  const where = loc === null ? "no location" : loc.path === row.test_path ? "location in own test file" : "location in another file";
  bump(`${row.kind}: ${where}`);
  if (loc !== null) {
    const sameFile = frames.find((p) => p.path === loc.path);
    if (sameFile === undefined) bump(`${row.kind}: location's file not in stack text`);
    else if (sameFile.line === loc.line && (sameFile.column === null || sameFile.column === loc.column)) bump(`${row.kind}: stack text's frame = location (mapped alike)`);
    else bump(`${row.kind}: stack text's frame != location`);
  }
  if (where === "location in another file") {
    bump(`${row.kind}: helper location, own test-file frame in stack text: ${own !== undefined}`);
    if (examples.length < 6) examples.push({ project, test: row.test_path, location: `${loc.path}:${loc.line}:${loc.column}`, ownFrame: own === undefined ? null : `${own.path}:${own.line}:${own.column}` });
  }
  if (where === "no location") bump(`${row.kind}: no location, own test-file frame in stack text: ${own !== undefined}`);
}
for (const [k, n] of [...count].sort()) console.log(`${String(n).padStart(5)}  ${k}`);
console.log("examples of a helper location:");
for (const e of examples) console.log(`  ${JSON.stringify(e)}`);
