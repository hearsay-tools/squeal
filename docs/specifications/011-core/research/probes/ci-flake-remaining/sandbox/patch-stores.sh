#!/usr/bin/env bash
# Throwaway probe, row 011-440. Runs ON the sandbox, after patch-why.sh. In the sandbox clone only:
# - src/core/store/open.ts openReadOnly logs every call (pid, time, file, wanted version, what it read,
#   the error) to /home/user/out/cur/stores.log;
# - src/cli/status-at-run-child.ts runChild logs the answer's kept/notKept counts to the same file.
# why-loop.sh points /home/user/out/cur at the current run's folder.
set -euo pipefail
cd /home/user/squeal
git checkout -q -- src/core/store/open.ts src/cli/status-at-run-child.ts
L=/home/user/out/cur/stores.log
node - "$L" <<'JS'
const fs = require("fs");
const L = process.argv[2];
const p = "src/core/store/open.ts";
let t = fs.readFileSync(p, "utf8");
const old = `export function openReadOnly(path: AbsolutePath, version: number): DatabaseSync | "missing" | null {
  if (!existsSync(path)) return "missing";
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec(\`PRAGMA busy_timeout = \${DEFAULT_BUSY_TIMEOUT_MS}\`);
    if (userVersion(db) === version) return db;
  } catch {
    // An unreadable store is no store to its reader.
  }
  db?.close();
  return null;
}`;
if (!t.includes(old)) throw new Error("openReadOnly not found");
const neu = `export function openReadOnly(path: AbsolutePath, version: number): DatabaseSync | "missing" | null {
  const __log = (what: string) => { try { require_appendFileSync(${JSON.stringify(L)}, \`\${Date.now()} pid=\${process.pid} openReadOnly \${path} want=\${version} \${what}\\n\`); } catch {} };
  if (!existsSync(path)) { __log("missing"); return "missing"; }
  let db: DatabaseSync | undefined;
  let got: unknown = "none";
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec(\`PRAGMA busy_timeout = \${DEFAULT_BUSY_TIMEOUT_MS}\`);
    got = userVersion(db);
    if (got === version) { __log(\`ok got=\${got}\`); return db; }
  } catch (e) {
    got = \`error \${(e as Error).message}\`;
  }
  __log(\`null got=\${String(got)}\`);
  db?.close();
  return null;
}`;
t = t.replace(old, neu);
t = 'import { appendFileSync as require_appendFileSync } from "node:fs";\n' + t;
fs.writeFileSync(p, t);
const c = "src/cli/status-at-run-child.ts";
let u = fs.readFileSync(c, "utf8");
const a = "    answer = { result };\n";
if (!u.includes(a)) throw new Error("runChild answer not found");
u = u.replace(a, a + `    try { require_appendFileSync(${JSON.stringify(L)}, \`\${Date.now()} pid=\${process.pid} child answer kept=\${result.kept?.length} notKept=\${result.notKept?.length} runs=\${result.runs.length}\\n\`); } catch {}\n`);
u = 'import { appendFileSync as require_appendFileSync } from "node:fs";\n' + u;
fs.writeFileSync(c, u);
JS
git diff --stat
