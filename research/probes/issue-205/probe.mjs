import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Throwaway, bounded reproduction. No repository suite or daemon is started.
const dir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(dir, "../../..");
const cli = process.argv[2] ?? "/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal";
const out = resolve(dir, "evidence");
mkdirSync(out, { recursive: true });
const samples = [];
function loadCheck(phase) {
  const sample = { phase, at: new Date().toISOString(), load1: loadavg()[0], cpus: cpus().length };
  samples.push(sample);
  writeFileSync(resolve(out, "load.json"), `${JSON.stringify(samples, null, 2)}\n`);
  if (sample.load1 > sample.cpus) throw new Error(`Live probe skipped: ${JSON.stringify(sample)}`);
}
loadCheck("before fixture");
const scratch = resolve(dir, ".tmp");
mkdirSync(scratch, { recursive: true });
const root = mkdtempSync(resolve(scratch, "fixture-"));
const commands = [];
function run(command, args, cwd = root, name) {
  commands.push({ command, args, cwd: cwd === root ? "<fixture>" : cwd });
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (name) {
    writeFileSync(resolve(out, `${name}.stdout`), result.stdout ?? "");
    writeFileSync(resolve(out, `${name}.stderr`), result.stderr ?? "");
  }
  writeFileSync(resolve(out, "commands.json"), `${JSON.stringify(commands, null, 2)}\n`);
  if (result.error || result.status !== 0)
    throw new Error(`${command}: ${result.error ?? result.status}\n${result.stderr}`);
  return result.stdout;
}
function write(path, text) {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(resolve(root, path), text);
}
try {
  write(".gitignore", "node_modules/\nparts/\n");
  write(
    "package.json",
    `${JSON.stringify({ name: "issue-205-probe", private: true, type: "module" })}\n`,
  );
  write(
    "vitest.config.ts",
    'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], maxWorkers: 1 } });\n',
  );
  write("src/value.ts", "export function value() {\n  return 1;\n}\n");
  for (const name of ["accepted", "refused"])
    write(
      `test/${name}.test.ts`,
      'import { expect, it } from "vitest";\nimport { value } from "../src/value.js";\nit("returns a positive value", () => { expect(value()).toBeGreaterThan(0); });\n',
    );
  symlinkSync(resolve(repo, "node_modules"), resolve(root, "node_modules"), "dir");
  run("git", ["init", "-q"]);
  run("git", ["add", ".gitignore", "package.json", "vitest.config.ts", "src", "test"]);
  run("git", [
    "-c",
    "user.name=Probe",
    "-c",
    "user.email=probe@example.invalid",
    "commit",
    "-qm",
    "base",
  ]);
  write("src/value.ts", "export function value() {\n  return 2;\n}\n");
  const version = run(cli, ["--version"], root, "version").trim();
  loadCheck("before record");
  run(
    cli,
    [
      "ci",
      "record",
      "--out",
      "parts",
      "--",
      process.execPath,
      resolve(repo, "node_modules/vitest/vitest.mjs"),
      "run",
    ],
    root,
    "record",
  );
  const names = readdirSync(resolve(root, "parts")).filter((n) => n.endsWith(".json"));
  assert.equal(names.length, 1);
  const partPath = resolve(root, "parts", names[0]);
  const part = JSON.parse(readFileSync(partPath, "utf8"));
  const victim = "test/refused.test.ts";
  assert.ok(part.testFiles.every((f) => f.outcome === "pass" && typeof f.record === "number"));
  const args = ["code", "--base", "HEAD", "--json", "--timeout", "30", "--parts", "parts"];
  loadCheck("before accepted control");
  const accepted = JSON.parse(run(cli, args, root, "accepted"));
  assert.equal(accepted.runs[0].from[victim], "parts");
  assert.equal(accepted.runs[0].from["test/accepted.test.ts"], "parts");
  const original = part.evidence[victim];
  assert.equal(typeof original, "string");
  part.evidence[victim] = "0".repeat(original.length);
  writeFileSync(partPath, `${JSON.stringify(part)}\n`);
  // Only our disposable fixture's stores are removed, so no stored pass can hide refusal.
  rmSync(resolve(root, ".git/squeal"), { recursive: true, force: true });
  loadCheck("before refused case");
  const refused = JSON.parse(run(cli, args, root, "refused"));
  assert.equal(refused.runs[0].from[victim], "run");
  assert.equal(refused.runs[0].from["test/accepted.test.ts"], "parts");
  assert.equal(refused.verdict, "pass");
  const summary = {
    version,
    node: process.version,
    vitest: JSON.parse(readFileSync(resolve(repo, "node_modules/vitest/package.json"), "utf8"))
      .version,
    partFormat: part.format,
    coverage: part.header.coverage,
    mutation: { path: victim, original, replacement: part.evidence[victim] },
    files: part.testFiles.map(({ path, outcome, record }) => ({ path, outcome, record })),
    accepted: { verdict: accepted.verdict, from: accepted.runs[0].from },
    refused: { verdict: refused.verdict, from: refused.runs[0].from },
    assertions: "all passed",
  };
  writeFileSync(resolve(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
