#!/usr/bin/env bash
# Throwaway probe, row 011-436. Runs ON a sandbox. In the sandbox clone only, makes the gitShim of
# test/integration/optimizer-start.test.ts log every call to $SHIM_LOG: time, pid, ppid, argv, whether
# it claimed the call, and src/mod.js's bytes (od -c) before and after the write.
set -euo pipefail
cd /home/user/squeal
git checkout -q -- test/integration/optimizer-start.test.ts
node <<'JS'
const fs = require("fs");
const p = "test/integration/optimizer-start.test.ts";
let t = fs.readFileSync(p, "utf8");
const a = '    "#!/bin/sh",\n';
const b = '    `if [ -d \'${cache}\' ] && mkdir \'${once}\' 2>/dev/null; then`,\n';
const c = '    "fi",\n';
for (const s of [a, b, c]) if (!t.includes(s)) throw new Error("missing " + s);
const mod = "${join(root, \"src/mod.js\")}";
t = t.replace(a, () => a + '    `L="\\${SHIM_LOG:-/dev/null}"; echo "$(date +%s.%N) pid=$$ ppid=$PPID root=${root} args=$*" >> "$L"`,\n');
t = t.replace(b, () => b + '    `  echo "$(date +%s.%N) pid=$$ CLAIMED before=$(od -An -c \'' + mod + '\' | tr -s \' \\n\' \' \')" >> "$L"`,\n');
t = t.replace(c, () => '    `  echo "$(date +%s.%N) pid=$$ WROTE after=$(od -An -c \'' + mod + '\' | tr -s \' \\n\' \' \')" >> "$L"`,\n' + c);
fs.writeFileSync(p, t);
JS
grep -n 'SHIM_LOG\|CLAIMED\|WROTE' test/integration/optimizer-start.test.ts
