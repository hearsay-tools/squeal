// Throwaway probe (row 025-14). Start cost of each `node:` builtin the hook
// bundles import: `node <file>` where the file imports that builtin alone,
// against an empty file, runs interleaved. Prints p50/p95 and p50 over empty.
// Usage: node builtins.mjs <scratchDir> [runs] [node binary]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, runs = "30", node = process.execPath] = process.argv.slice(2);
const mods = ["async_hooks", "child_process", "crypto", "diagnostics_channel", "fs", "fs/promises",
  "module", "net", "os", "path", "sqlite", "timers/promises", "url", "util", "zlib"];
mkdirSync(dir, { recursive: true });
const files = { empty: "" };
for (const m of mods) files[m] = `import * as x from "node:${m}"; void x;\n`;
files.all = mods.map((m, i) => `import * as x${i} from "node:${m}"; void x${i};`).join("\n");
// Marginal cost of each builtin beside all the others.
for (const m of mods) files[`all-but-${m}`] = mods.filter((x) => x !== m).map((x, i) => `import * as x${i} from "node:${x}"; void x${i};`).join("\n");
files["all-but-child_process-crypto-net-zlib"] = mods.filter((x) => !["child_process", "crypto", "net", "zlib"].includes(x)).map((x, i) => `import * as x${i} from "node:${x}"; void x${i};`).join("\n");
// The same builtins without ESM import facades.
files["all-getBuiltinModule"] = mods.map((m, i) => `const x${i} = process.getBuiltinModule("node:${m}"); void x${i};`).join("\n");
files["all-named"] = `import { createHash } from "node:crypto"; import { readFileSync } from "node:fs"; import { readFile } from "node:fs/promises"; import { spawn } from "node:child_process"; import { createConnection } from "node:net"; import { inspect } from "node:util"; import { gzipSync } from "node:zlib"; import { join } from "node:path"; import { tmpdir } from "node:os"; import { DatabaseSync } from "node:sqlite"; import { AsyncLocalStorage } from "node:async_hooks"; import { channel } from "node:diagnostics_channel"; import { createRequire } from "node:module"; import { setTimeout } from "node:timers/promises"; import { fileURLToPath } from "node:url"; void [createHash, readFileSync, readFile, spawn, createConnection, inspect, gzipSync, join, tmpdir, DatabaseSync, AsyncLocalStorage, channel, createRequire, setTimeout, fileURLToPath];`;
// What a hook does with sqlite: open a database in memory.
files["sqlite-open"] = `import { DatabaseSync } from "node:sqlite"; new DatabaseSync(":memory:").close();\n`;
for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, `${k.replace("/", "-")}.mjs`), v);
const ms = Object.fromEntries(Object.keys(files).map((k) => [k, []]));
for (let r = 0; r < Number(runs); r++) {
  for (const k of Object.keys(files)) {
    const t = performance.now();
    spawnSync(node, ["--disable-warning=ExperimentalWarning", join(dir, `${k.replace("/", "-")}.mjs`)], { env: { PATH: process.env.PATH } });
    ms[k].push(performance.now() - t);
  }
}
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
const base = q(ms.empty, 0.5);
for (const [k, xs] of Object.entries(ms)) {
  console.log(`${k.padEnd(20)} ${q(xs, 0.5).toFixed(1).padStart(6)}/${q(xs, 0.95).toFixed(1).padStart(6)}  +${(q(xs, 0.5) - base).toFixed(1)}`);
}
