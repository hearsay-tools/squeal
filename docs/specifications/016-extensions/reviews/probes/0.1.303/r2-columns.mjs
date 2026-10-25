import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const scratch = mkdtempSync(join(tmpdir(), 'squeal-r2-columns-'));
const path = join(scratch, 'store.sqlite');
const old = new DatabaseSync(path);
let newer;
try {
  old.exec("CREATE TABLE results (id INTEGER, outcome TEXT); CREATE TABLE failure_texts (summary TEXT, errors TEXT); INSERT INTO results VALUES (1, 'fail'); INSERT INTO failure_texts VALUES ('failed', '[]')");
  const held = old.prepare('SELECT r.*, f.summary, f.errors FROM results r CROSS JOIN failure_texts f');
  const before = held.all()[0];
  newer = new DatabaseSync(path);
  newer.exec('ALTER TABLE results ADD COLUMN runner TEXT');
  const after = held.all()[0];
  console.log(JSON.stringify({ node: process.version, before, after }));
  assert.equal(after.errors, '[]', 'an older prepared SELECT must still read its errors column');
} finally {
  newer?.close(); old.close(); rmSync(scratch, { recursive: true, force: true });
}
