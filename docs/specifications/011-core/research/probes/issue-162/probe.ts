// Throwaway research probe. No daemon or tests are started.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/open.js";

const cli = resolve(process.argv[2] ?? "plugins/claude-code/dist/cli/squeal.mjs");
const cpus = Number(execFileSync("getconf", ["_NPROCESSORS_ONLN"], { encoding: "utf8" }));
const child = [
  "const fs = require('node:fs');",
  "const { DatabaseSync } = require('node:sqlite');",
  "const db = new DatabaseSync(process.argv[2], { readOnly: true });",
  "const rows = db.prepare(\"SELECT key,value FROM meta WHERE key LIKE 'command-hold:%'\").all();",
  "db.close();",
  "fs.writeFileSync(process.argv[1], JSON.stringify({ childStarted: true, holdsAtChildStart: rows }));",
  "console.log('issue-162-marker');",
].join(" ");

for (const locked of [true, false]) {
  const load = loadavg()[0];
  const gate = { time: new Date().toISOString(), load1: load, onlineCpus: cpus, locked };
  if (load > cpus) {
    console.log(JSON.stringify({ ...gate, skipped: "one-minute load exceeds online CPUs" }));
    continue;
  }
  const root = mkdtempSync(join(tmpdir(), "squeal-issue-162-"));
  let locker: DatabaseSync | undefined;
  try {
    execFileSync("git", ["init", "--quiet", root]);
    const commonDir = join(root, ".git");
    const store = openStore(commonDir);
    if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    store.close();
    const database = join(commonDir, "squeal", "store.sqlite");
    const marker = join(root, "marker.json");
    locker = new DatabaseSync(database);
    if (locked) locker.exec("BEGIN IMMEDIATE");
    const version = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, "--version"], {
      cwd: root, encoding: "utf8", timeout: 10_000,
    });
    const args = ["--disable-warning=ExperimentalWarning", cli, "hold", "--max", "30m", "--",
      process.execPath, "--disable-warning=ExperimentalWarning", "-e", child, marker, database];
    const started = performance.now();
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 15_000 });
    console.log(JSON.stringify({
      ...gate, node: process.version, cli, runtimeVersion: version.stdout.trim(), root,
      command: [process.execPath, ...args], elapsedMs: Math.round(performance.now() - started),
      exitCode: result.status, signal: result.signal, error: result.error?.message,
      stdout: result.stdout, stderr: result.stderr,
      marker: existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")) : null,
      holdsAfter: locker.prepare("SELECT key,value FROM meta WHERE key LIKE 'command-hold:%'").all(),
    }));
  } finally {
    if (locker?.isTransaction) locker.exec("ROLLBACK");
    locker?.close();
    rmSync(root, { recursive: true, force: true });
  }
}
