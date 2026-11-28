#!/usr/bin/env bash
# Throwaway probe, row 011-439. Runs ON a sandbox. In the sandbox clone only: test/integration/node-test.test.ts
# runs its hooks with SQUEAL_HOOK_DEBUG=1 and appends, for every hook call, the hook name, time, whether it
# printed, and its stderr (the swallowed error) to $HOOK_LOG.
set -euo pipefail
cd /home/user/squeal
git checkout -q -- test/integration/node-test.test.ts
node <<'JS'
const fs = require("fs");
const p = "test/integration/node-test.test.ts";
let t = fs.readFileSync(p, "utf8");
const a = 'const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };';
const b = '  const out = await runHook(name, recorded(name, root), deps);\n  return contextOf(out);';
for (const s of [a, b]) if (!t.includes(s)) throw new Error("missing " + s);
t = t.replace(a, () => 'const deps: HookDeps = { env: { SQUEAL_HOOK_DEBUG: "1" }, ensureDaemon: async () => "alive" };');
t = t.replace(b, () => '  const started = Date.now();\n  const out = await runHook(name, recorded(name, root), deps);\n  const text = contextOf(out);\n  if (process.env.HOOK_LOG) (await import("node:fs")).appendFileSync(process.env.HOOK_LOG, `${started} ${name} ${Date.now() - started}ms printed=${text !== ""} stderr=${JSON.stringify(out.stderr)}\\n`);\n  return text;');
fs.writeFileSync(p, t);
JS
git diff --stat test/integration/node-test.test.ts
