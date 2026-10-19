// THROWAWAY probe (011-core/research/streaming-lanes.md). Writes a node:test-only fixture
// repository: `heavy` = 16 files idling 20 to 90 s; `light` = N files of about 50 ms of work.
// One quick test file (`node/quick.test.mjs`, importing `node/quick.mjs`) is what an edit hits.
// Usage: node make-fixture.mjs <dir> heavy|light [N]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, shape, nArg] = process.argv.slice(2);
const w = (path, body) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), body);
};
const spread = (n, lo, hi) => Array.from({ length: n }, (_, i) => Math.round(lo + ((hi - lo) * i) / (n - 1)));
if (shape === "heavy") {
  for (const [i, s] of spread(16, 20, 90).entries()) {
    w(`node/heavy-${String(i).padStart(2, "0")}.test.mjs`,
      `import { test } from "node:test";\ntest("idle ${s} s", async () => {\n  await new Promise((r) => setTimeout(r, ${s * 1000}));\n});\n`);
  }
} else {
  const n = Number(nArg ?? 300);
  for (let i = 0; i < n; i++) {
    w(`node/light-${String(i).padStart(3, "0")}.test.mjs`,
      `import { test } from "node:test";\nimport assert from "node:assert";\ntest("light ${i}", () => {\n  let x = 0;\n  const end = Date.now() + 50;\n  while (Date.now() < end) x++;\n  assert.ok(x > 0);\n});\n`);
  }
}
w("node/quick.mjs", "export const quick = 1;\n");
w("node/quick.test.mjs",
  `import { test } from "node:test";\nimport assert from "node:assert";\nimport { quick } from "./quick.mjs";\ntest("quick", () => assert.ok(quick > 0));\n`);
w("package.json", `${JSON.stringify({ name: "fx", private: true, type: "module" }, null, 2)}\n`);
w("squeal.config.json", `${JSON.stringify({ nodeTest: [{ name: "fx-node", include: ["node/**/*.test.mjs"] }] }, null, 2)}\n`);
w(".gitignore", "node_modules\n");
const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.email=p@p", "-c", "user.name=p", "commit", "-qm", "fixture");
