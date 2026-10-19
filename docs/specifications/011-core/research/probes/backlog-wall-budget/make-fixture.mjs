// THROWAWAY probe (011-core/research/backlog-wall-budget.md). Writes a fixture repository of heavy,
// mostly idle test files: one Vitest project and one node:test project, plus one quick test
// file per runner that an edit targets. Usage: node make-fixture.mjs <dir> <install-template>
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, install] = process.argv.slice(2);
const w = (path, body) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), body);
};
// 60 to 150 s, spread evenly: 16 Vitest files, 8 node:test files.
const spread = (n) => Array.from({ length: n }, (_, i) => Math.round(60 + (90 * i) / (n - 1)));
const sleep = (s) =>
  `await new Promise((r) => setTimeout(r, ${s * 1000}));\n`;
for (const [i, s] of spread(16).entries()) {
  w(`test/heavy-${String(i).padStart(2, "0")}.test.ts`,
    `import { test } from "vitest";\ntest("idle ${s} s", async () => {\n  ${sleep(s)}});\n`);
}
w("src/quick.ts", "export const quick = 1;\n");
w("test/quick.test.ts",
  `import { expect, test } from "vitest";\nimport { quick } from "../src/quick";\ntest("quick", () => expect(quick).toBeGreaterThan(0));\n`);
for (const [i, s] of spread(8).entries()) {
  w(`node/heavy-${i}.test.mjs`,
    `import { test } from "node:test";\ntest("idle ${s} s", async () => {\n  ${sleep(s)}});\n`);
}
w("node/quick.mjs", "export const quick = 1;\n");
w("node/quick.test.mjs",
  `import { test } from "node:test";\nimport assert from "node:assert";\nimport { quick } from "./quick.mjs";\ntest("quick", () => assert.ok(quick > 0));\n`);
w("vitest.config.ts",
  `export default { test: { include: ["test/**/*.test.ts"], testTimeout: 400_000, hookTimeout: 60_000 } };\n`);
w("squeal.config.json", `${JSON.stringify({ nodeTest: [{ name: "heavy-node", include: ["node/**/*.test.mjs"] }] }, null, 2)}\n`);
w(".gitignore", "node_modules\n");
cpSync(join(install, "package.json"), join(dir, "package.json"));
cpSync(join(install, "package-lock.json"), join(dir, "package-lock.json"));
execFileSync("cp", ["-a", join(install, "node_modules"), join(dir, "node_modules")]);
const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.email=p@p", "-c", "user.name=p", "commit", "-qm", "fixture");
