#!/usr/bin/env bash
# Throwaway probe, row 011-439. Runs ON a sandbox. In the sandbox clone only: src/core/daemon/write-desk.ts
# logs to /home/user/out/cur/desk.log each lease granted or refused (with the holder in force), each write
# taken under a lease and its settle (pending, releasing, whether the lease ended), and each release.
set -euo pipefail
cd /home/user/squeal
git checkout -q -- src/core/daemon/write-desk.ts
node <<'JS'
const fs = require("fs");
const p = "src/core/daemon/write-desk.ts";
let t = fs.readFileSync(p, "utf8");
const L = '"/home/user/out/cur/desk.log"';
const log = (what) => `try { __a(${L}, \`\${Date.now()} daemon=\${process.pid} ${what}\\n\`); } catch {}`;
const r = (a, b) => { if (!t.includes(a)) throw new Error("missing: " + a); t = t.replace(a, () => b); };
r("    if (current !== null) return this.#leaseAnswer(null, current.holder);\n    const token = randomUUID();\n",
  "    if (current !== null) { " + log("lease refused to ${request.holder.split(\" \")[0]}: held by ${current.holder.split(\" \")[0]} pending=${current.pending} releasing=${current.releasing}") + " return this.#leaseAnswer(null, current.holder); }\n    const token = randomUUID();\n    " + log("lease granted to ${request.holder.split(\" \")[0]} token=${token.slice(0, 8)}") + "\n");
r("    if (lease?.token === request.token) {\n      if (lease.pending > 0)",
  "    " + log("release token=${request.token.slice(0, 8)} current=${lease?.token.slice(0, 8)} pending=${lease?.pending}") + "\n    if (lease?.token === request.token) {\n      if (lease.pending > 0)");
r("      if (request.release) lease.releasing = true;\n    }\n",
  "      if (request.release) lease.releasing = true;\n    }\n    " + log("write token=${request.token?.slice(0, 8)} underLease=${lease !== null} release=${request.release} pending=${lease?.pending}") + "\n");
r("      if (lease.releasing && lease.pending === 0 && this.#lease === lease) this.#lease = null;\n    };",
  "      if (lease.releasing && lease.pending === 0 && this.#lease === lease) this.#lease = null;\n      " + log("settled token=${lease.token.slice(0, 8)} error=${error} pending=${lease.pending} ended=${this.#lease !== lease}") + "\n    };");
t = 'import { appendFileSync as __a } from "node:fs";\n' + t;
fs.writeFileSync(p, t);
JS
git diff --stat src/core/daemon/write-desk.ts
