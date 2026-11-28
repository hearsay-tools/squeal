#!/usr/bin/env bash
# Throwaway probe, row 011-440. Runs ON the sandbox after patch-stores.sh. In the sandbox clone only:
# the candidate repair in src/core/code/gate/stored.ts readStores: a code.sqlite that is still being
# created (schema version 0, or locked by its creator) counts as missing, not unreadable, so the gate
# still keeps what it runs (its keeper opens the code store with create, which waits for the creator).
# Logs each such case to /home/user/out/cur/stores.log as "creating".
set -euo pipefail
cd /home/user/squeal
git checkout -q -- src/core/code/gate/stored.ts
node <<'JS'
const fs = require("fs");
const p = "src/core/code/gate/stored.ts";
let t = fs.readFileSync(p, "utf8");
const a = "  const codeDb = openReadOnly(codePath, CODE_SCHEMA_VERSION);\n";
if (!t.includes(a)) throw new Error("readStores code open not found");
t = t.replace(a, () => `  const codeFirst = openReadOnly(codePath, CODE_SCHEMA_VERSION);
  const codeDb = codeFirst === null && __creating(codePath) ? "missing" : codeFirst;
`);
t += `
/** Probe: a store file still being created: schema version 0, or locked at once by its creator. */
function __creating(path: string): boolean {
  let db: DatabaseSync | undefined;
  let creating = false;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    creating = Number(Object.values(db.prepare("PRAGMA user_version").get() ?? {})[0]) === 0;
  } catch (error) {
    creating = String(error).includes("database is locked");
  }
  db?.close();
  if (creating) { try { require_appendFileSync("/home/user/out/cur/stores.log", \`\${Date.now()} pid=\${process.pid} readStores creating -> missing\\n\`); } catch {} }
  return creating;
}
`;
t = 'import { DatabaseSync } from "node:sqlite";\nimport { appendFileSync as require_appendFileSync } from "node:fs";\n' + t;
fs.writeFileSync(p, t);
JS
grep -c "__creating" src/core/code/gate/stored.ts
