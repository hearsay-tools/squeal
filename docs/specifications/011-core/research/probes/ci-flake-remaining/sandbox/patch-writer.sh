#!/usr/bin/env bash
# Throwaway probe, row 011-439. Runs ON a sandbox after patch-nodetest.sh. In the sandbox clone only:
# src/core/delivery/daemon-writer.ts logs to /home/user/out/cur/writer.log, with pid and time, each lease
# taken, each release request and whether the daemon answered it, and each write-status poll that throws.
set -euo pipefail
cd /home/user/squeal
git checkout -q -- src/core/delivery/daemon-writer.ts
node <<'JS'
const fs = require("fs");
const p = "src/core/delivery/daemon-writer.ts";
let t = fs.readFileSync(p, "utf8");
const L = '"/home/user/out/cur/writer.log"';
const log = (what) => `try { __a(${L}, \`\${Date.now()} pid=\${process.pid} ${what}\\n\`); } catch {}`;
const r = (a, b) => { if (!t.includes(a)) throw new Error("missing: " + a); t = t.replace(a, () => b); };
r("        this.#token = answer.token;\n        return true;\n", "        this.#token = answer.token;\n        " + log("lease taken") + "\n        return true;\n");
r("    await this.#ask(socket, { type: \"release\", worktreeId, token });\n  }\n\n  #socketPath",
  "    const __r = await this.#ask(socket, { type: \"release\", worktreeId, token });\n    " + log("release answered=${__r !== null}") + "\n  }\n\n  #socketPath");
r("      const next = await requestDaemon(\n        socket,\n        { type: \"write-status\", requestId: answer.requestId },\n        SMALL_REQUEST_TIMEOUT_MS,\n      );\n",
  "      const next = await requestDaemon(\n        socket,\n        { type: \"write-status\", requestId: answer.requestId },\n        SMALL_REQUEST_TIMEOUT_MS,\n      ).catch((e) => { " + log("write-status threw ${String(e)}") + " throw e; });\n");
r("    const answer = await this.#ask(socket, request);\n    if (!isWrite(answer))", "    const answer = await this.#ask(socket, request);\n    " + log("write release=${release} answered=${answer !== null}") + "\n    if (!isWrite(answer))");
t = 'import { appendFileSync as __a } from "node:fs";\n' + t;
fs.writeFileSync(p, t);
JS
git diff --stat src/core/delivery/daemon-writer.ts
