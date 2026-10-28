// Probe only: per-file closure difference between lib absent and lib as an environment, plus incomplete reasons.
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPytestGraph } from "../../../../../../src/runners/pytest/graph/index.js";
const [root, cwd, lib, ...files] = process.argv.slice(2) as string[];
const v = lib.split("/").at(-2) as string;
const env = mkdtempSync(join(tmpdir(), "pep582-env-"));
writeFileSync(join(env, "pyvenv.cfg"), `home = /nonexistent/bin\nversion_info = ${v}\n`);
mkdirSync(join(env, "lib", `python${v}`), { recursive: true });
symlinkSync(lib, join(env, "lib", `python${v}`, "site-packages"));
const a = await createPytestGraph({ root, cwd, env: null, testFiles: files });
const b = await createPytestGraph({ root, cwd, env, testFiles: files });
for (const f of files) {
  const x = new Set(a.closure(f).paths), y = new Set(b.closure(f).paths);
  console.log(f, "only without lib:", [...x].filter((p) => !y.has(p)).slice(0, 8), "only with lib:", [...y].filter((p) => !x.has(p)).slice(0, 8));
  console.log("   incomplete:", b.closure(f).incomplete.slice(0, 3));
}
console.log("derived search path:", a.searchPath().locations.filter((l) => l.kind === "dir").map((l) => (l as { dir: string }).dir.replace(root, "<root>")));
