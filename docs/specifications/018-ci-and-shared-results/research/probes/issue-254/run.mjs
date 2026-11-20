// Throwaway public-CLI reproduction. No product code is imported or changed.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = dirname(fileURLToPath(import.meta.url));
const repo = resolve(own, "../../../../../..");
const cli = join(repo, "plugins/claude-code/dist/cli/squeal.mjs");
const vitest = join(repo, "node_modules/vitest/vitest.mjs");
mkdirSync(join(own, ".tmp"), { recursive: true });
const scratch = mkdtempSync(join(own, ".tmp/run-"));
const clean = (s) => s.replaceAll(scratch, "<scratch>").replaceAll(repo, "<repo>").replaceAll(process.execPath, "node");
function run(bin, args, cwd, show = true) {
  const result = spawnSync(bin, args, {
    cwd, encoding: "utf8", timeout: 90000,
    env: { ...process.env, CI: "true", NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  if (show) {
    console.log(`$ (cd ${clean(cwd)} && ${clean([bin, ...args].join(" "))})`);
    console.log(clean((result.stdout + result.stderr).trim()));
    console.log(`exit=${result.status}`);
  }
  if (result.error) throw result.error;
  return result;
}
function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
console.log(`Node ${process.version}; CPUs ${cpus().length}; load ${loadavg().join(" ")}`);
run(process.execPath, [cli, "--version"], repo);
for (const reads of [false, true]) {
  const load = loadavg()[0];
  console.log(`Before ${reads ? "read-control" : "unread"}: one-minute load ${load}; CPUs ${cpus().length}`);
  if (load > cpus().length) throw new Error("Host load exceeds CPU count; skipping live probes");
  const name = reads ? "read-control" : "unread";
  const root = join(scratch, name);
  const files = {
    "package.json": JSON.stringify({ name: "issue-254", private: true, type: "module" }),
    ".gitignore": "node_modules\n",
    "vitest.config.ts": 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], maxWorkers: 1 } });\n',
    "squeal.config.json": JSON.stringify({ inputs: { "test/declared.test.ts": ["docs/unused.md"] } }),
    "docs/unused.md": "declared tracked input\n",
    "src/lazy.ts": 'export const value = "lazy";\n',
    "test/control.test.ts": 'import { it, expect } from "vitest";\nit("control", () => expect(1).toBe(1));\n',
    "test/declared.test.ts": 'import { it, expect } from "vitest";\n' + (reads ? 'import { readFileSync } from "node:fs";\n' : '') + 'it("declared", () => {' + (reads ? 'expect(readFileSync(new URL("../docs/unused.md", import.meta.url), "utf8")).toBe("declared tracked input\\n");' : 'expect(1).toBe(1);') + '});\n',
    "test/lazy.test.ts": 'import { it, expect } from "vitest";\nconst load = () => import("../src/lazy.ts");\nit("lazy", async () => {' + (reads ? 'expect((await load()).value).toBe("lazy");' : 'expect(typeof load).toBe("function");') + '});\n',
  };
  for (const [path, content] of Object.entries(files)) write(root, path, content);
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "fixture"]]) {
    if (run("git", args, root, false).status !== 0) throw new Error("fixture git setup failed");
  }
  run("git", ["status", "--porcelain"], root);
  const parts = join(scratch, `${name}-parts`);
  if (run(process.execPath, [cli, "ci", "record", "--out", parts, "--", process.execPath, vitest, "run", "--maxWorkers=1"], root).status !== 0) throw new Error("record failed");
  for (const path of readdirSync(parts)) {
    const part = JSON.parse(readFileSync(join(parts, path), "utf8"));
    console.log(JSON.stringify({ header: { format: part.format, dirty: part.header.dirty, commit: part.header.commit }, files: part.testFiles.map(f => ({path:f.path, outcome:f.outcome, checks:f.checks.map(c=>c.outcome)})), evidence: Object.fromEntries(["docs/unused.md", "src/lazy.ts"].map(p=>[p, Object.hasOwn(part.evidence,p) ? part.evidence[p] : "MISSING"])) }));
  }
  const fresh = join(scratch, `${name}-export`);
  if (run("git", ["clone", "-q", root, fresh], scratch, false).status !== 0) throw new Error("clone failed");
  symlinkSync(join(repo, "node_modules"), join(fresh, "node_modules"));
  run("git", ["status", "--porcelain"], fresh);
  const out = join(scratch, `${name}.json.gz`);
  run(process.execPath, [cli, "ci", "export", "--parts", parts, "--out", out], fresh);
  const bundle = JSON.parse(gunzipSync(readFileSync(out)));
  console.log(JSON.stringify({ exported: bundle.testFiles.map(f => ({path:f.path, closure:f.closure.paths})) }));
}
