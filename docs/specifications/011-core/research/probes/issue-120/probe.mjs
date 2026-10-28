// Throwaway research probe. Runs read-only CLIs in a disposable Git repository.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runtimes = process.argv.slice(2);
if (runtimes.length === 0) throw new Error("Pass retained runtime directories");
const root = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), ".scratch-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(SQUEAL_|CODEX_SESSION_ID$|CLAUDE_CODE_SESSION_ID$|OPENCODE_SESSION_ID$|PI_SESSION_ID$|PLUGIN_|NODE_OPTIONS$)/.test(key)));
const config = {
  baseline: { onStart: "lookup-only" },
  inputs: ["fixtures/meaningful.json"],
  runtimeFiles: [{ project: "e2e", tests: ["packages/web/e2e/*.e2e.ts"], paths: [".ai/qa/test-env.json"] }],
};
console.log(JSON.stringify({ node: process.version, config }));
try {
  const git = spawnSync("git", ["init", "--quiet", root], { env, encoding: "utf8" });
  if (git.status !== 0) throw new Error(git.stderr);
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify(config));
  for (const runtime of runtimes) {
    const cli = join(runtime, "dist/cli/squeal.mjs");
    const manifest = JSON.parse(readFileSync(join(runtime, "runtime.json"), "utf8"));
    const sha256 = createHash("sha256").update(readFileSync(cli)).digest("hex");
    if (manifest.files["dist/cli/squeal.mjs"].sha256 !== sha256) throw new Error("CLI hash mismatch");
    console.log(JSON.stringify({ version: manifest.version, cli, sha256, manifestMatch: true }));
    for (const args of [["status", "--json"], ["status"]]) {
      const load = loadavg()[0];
      const cpuCount = cpus().length;
      console.log(JSON.stringify({ at: new Date().toISOString(), load, cpuCount, command: [process.execPath, "--disable-warning=ExperimentalWarning", cli, ...args], cwd: "disposable Git repository" }));
      if (load > cpuCount) { console.log("SKIPPED: one-minute load exceeds CPU count"); continue; }
      const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...args], { cwd: root, env, encoding: "utf8", timeout: 15000 });
      console.log(JSON.stringify({ exit: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }));
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
