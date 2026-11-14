#!/bin/sh
# Throwaway: writes the capability fixture (CJS, ESM, type-stripped .ts, worker
# thread, child process, dynamic import, a data file, a module two test files share).
set -e
D=${1:?target dir}
mkdir -p "$D" && cd "$D"
echo '{"name":"fx","private":true}' > package.json
cat > a.test.mjs <<'X'
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { execFileSync } from "node:child_process";
import { esm } from "./esm-dep.mjs";
import { ts } from "./ts-dep.ts";
import shared from "./shared.cjs";
const require = createRequire(import.meta.url);
test("a", async () => {
  const cjs = require("./cjs-dep.cjs");
  const data = JSON.parse(readFileSync(new URL("./data.json", import.meta.url), "utf8"));
  const dyn = await import("./dyn.mjs");
  await new Promise((ok, no) => { const w = new Worker(new URL("./worker-entry.mjs", import.meta.url)); w.on("exit", ok); w.on("error", no); });
  const child = execFileSync(process.execPath, [new URL("./child.mjs", import.meta.url).pathname], { encoding: "utf8" });
  const foo = require("./foo");
  if (!esm || !ts || !cjs || !data || !dyn || !child || !shared || !foo) throw new Error("x");
});
X
cat > b.test.mjs <<'X'
import { test } from "node:test";
import { createRequire } from "node:module";
import shared from "./shared.cjs";
import { esm } from "./esm-dep.mjs";
const require = createRequire(import.meta.url);
test("b", () => { const c = require("./cjs-dep.cjs"); if (!shared || !esm || !c) throw new Error("x"); });
X
echo 'import { leaf } from "./esm-leaf.mjs"; export const esm = leaf;' > esm-dep.mjs
echo 'export const leaf = 1;' > esm-leaf.mjs
echo 'import { tl } from "./ts-leaf.ts"; export const ts: number = tl;' > ts-dep.ts
echo 'export const tl: number = 2;' > ts-leaf.ts
echo 'module.exports = require("./cjs-leaf.cjs");' > cjs-dep.cjs
echo 'module.exports = { leaf: 3 };' > cjs-leaf.cjs
echo 'module.exports = require("./shared-leaf.cjs");' > shared.cjs
echo 'module.exports = { s: 4 };' > shared-leaf.cjs
echo 'export const d = 5;' > dyn.mjs
echo '{"k":6}' > data.json
echo 'import { wd } from "./worker-dep.mjs"; if (!wd) throw 1;' > worker-entry.mjs
echo 'export const wd = 7;' > worker-dep.mjs
echo 'import { cd } from "./child-dep.mjs"; console.log(cd);' > child.mjs
echo 'export const cd = 8;' > child-dep.mjs
mkdir -p foo && echo 'module.exports = "foo/index.js";' > foo/index.js
