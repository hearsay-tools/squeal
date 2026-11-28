#!/usr/bin/env bash
# Throwaway probe, row 011-438. Runs ON a sandbox. In the sandbox clone only: src/harness/pi/extension.ts's
# tool_call handler appends, per asked call, the tool, the ask's duration in ms and whether it blocked, to
# /home/user/out/cur/gate.log (a fixed path: Pi's environment is the test's own).
set -euo pipefail
cd /home/user/squeal
git checkout -q -- src/harness/pi/extension.ts
node <<'JS'
const fs = require("fs");
const p = "src/harness/pi/extension.ts";
let t = fs.readFileSync(p, "utf8");
const a = `      const reason = await ask(
        ctx,
        { kind: "toolCall", toolName: event.toolName, ...command },
        EVENT_DEADLINE_MS,
      );
`;
if (!t.includes(a)) throw new Error("tool_call ask not found");
t = t.replace(a, () => `      const __t = performance.now();
` + a + `      try { (await import("node:fs")).appendFileSync("/home/user/out/cur/gate.log", \`\${Date.now()} tool=\${event.toolName} ms=\${Math.round(performance.now() - __t)} blocked=\${reason !== null}\\n\`); } catch {}
`);
fs.writeFileSync(p, t);
JS
git diff --stat src/harness/pi/extension.ts
