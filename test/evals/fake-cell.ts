// A scratch evals root for running evals/bin/run-cell.mjs without a model, a provider or a real
// Squeal: fake `claude`, `codex` and `npx` on PATH, a fake Squeal CLI in the pinned plugins, and
// made-up credentials. Each fake's behaviour is chosen by FAKE_* variables, which reach the cell.
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cellProcesses, killCellProcess, startOf } from "./cell-processes.js";

export const TOKEN = "made-up-anthropic-token-0123456789abcdef";
export const PROXY_KEY = "made-up-proxy-key-0123456789abcdefghij";
export const HOST = "proxy.example.invalid";
export const STATUS_JSON = '{\n  "fake": true,\n  "knownFailures": 0\n}\n';
/** `status --json` with the calendar test's FAIL known (FAKE_INHERITED). */
const INHERITED_JSON = `${JSON.stringify({ knownFailures: [{ check: { testPath: "test/clock.test.ts" }, outcome: "fail" }] })}\n`;

const REPO = join(import.meta.dirname, "../..");
const write = (p: string, s: string, mode?: number) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, s);
  if (mode) chmodSync(p, mode);
};

/**
 * The `daemon` command of every fake Squeal, a block that needs `root`, the daemon's repository.
 * It leads its own session and carries no mark of Squeal's, as `runCell` gives the runner only
 * the cell's variables, so Squeal's stop of a test's leftovers never finds it: only the runner's
 * teardown and the test's own stopped it. A runner killed, a runner that crashed because its root
 * was removed under it, or a test process killed with its cancelled run, each left one running
 * with nothing to stop it: two for over an hour (014 lessons, P10). So it ends by itself
 * (014-32): once its root is gone, or once the test process that made the cell has ended.
 * `FAKE_OWNER` names that process as `<pid>:<start time>` (`startOf`), so an owner gone before
 * the daemon starts, a zombie, or a later process given its pid ends it too (review B4).
 */
export const FAKE_DAEMON = `{
  const { existsSync, readFileSync } = await import("node:fs");
  const [owner, start] = (process.env.FAKE_OWNER ?? "").split(":");
  // startOf's reading: the owner's start time while it runs; null once it has ended or is a zombie.
  const life = () => {
    try {
      const stat = readFileSync("/proc/" + owner + "/stat", "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return fields[0] === "Z" || fields[0] === "X" ? null : fields[19];
    } catch {
      return null;
    }
  };
  const ended = () => !existsSync(root) || (owner !== "" && life() !== start);
  if (ended()) process.exit(0);
  setInterval(() => ended() && process.exit(0), 500);
  // FAKE_STOP_MS: a stop's SIGTERM ends it only this many ms later, so a teardown that signals it
  // and does not wait for it leaves it running (006-95).
  const stopMs = Number(process.env.FAKE_STOP_MS ?? 0);
  if (stopMs) process.on("SIGTERM", () => setTimeout(() => process.exit(0), stopMs));
}`;

const FAKE_SQUEAL = `import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const [cmd, ...rest] = process.argv.slice(2);
const root = process.cwd();
const pidFile = join(root, ".git/squeal/fake.pid");
// Each command, with the slow policy it met (006-54: the load-hold knob lands after the warm-up),
// and what the retry knobs left it (006-53): the load per CPU it reads, the calendar's cold runs,
// whether the rates service's port file exists, and whether the load preload is set.
if (cmd !== "daemon") {
  let slow = null;
  try { slow = JSON.parse(readFileSync(join(root, "squeal.config.json"), "utf8")).slow ?? null; } catch {}
  const { loadavg, availableParallelism } = await import("node:os");
  const e = process.env;
  const retry = {
    load: e.EVAL_LOAD_PER_CPU_FILE ? +(loadavg()[0] / availableParallelism()).toFixed(2) : null,
    cold: e.LEDGERLINE_CALENDAR_COLD_RUNS ?? null,
    rates: existsSync(join(root, "scripts/rates-service.mjs")) ? existsSync(join(e.HOME, ".ledgerline-rates.port")) : null,
    preload: /loadavg\\.mjs/.test(e.NODE_OPTIONS ?? ""),
  };
  appendFileSync(join(process.env.FAKE_LOG, "squeal"), JSON.stringify({ args: [cmd, ...rest], slow, retry }) + "\\n");
}
// FAKE_INHERITED (006-53, review 006-57 S1, 006-62): the first command that runs the calendar
// test, a wait naming it or \`run --all\`, stores its FAIL with the load per CPU it reads, as a real
// daemon's baseline does once something waits on it; a plain \`status --wait\` returns before.
const store = join(root, ".git/squeal/store.sqlite");
if (process.env.FAKE_INHERITED && !existsSync(store) && ((cmd === "status" && rest.includes("test/clock.test.ts")) || (cmd === "run" && rest.includes("--all")))) {
  const { DatabaseSync } = await import("node:sqlite");
  const { loadavg, availableParallelism } = await import("node:os");
  const db = new DatabaseSync(store);
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE checks (id INTEGER PRIMARY KEY, test_path TEXT NOT NULL); CREATE TABLE results (check_id INTEGER NOT NULL, outcome TEXT NOT NULL, run_id TEXT NOT NULL)");
  db.exec("INSERT INTO checks VALUES (1, 'test/clock.test.ts'); INSERT INTO results VALUES (1, 'fail', 'r1')");
  db.prepare("INSERT INTO meta VALUES ('failed-run-loads', ?)").run(JSON.stringify({ r1: loadavg()[0] / availableParallelism() }));
  db.close();
}
if (cmd === "daemon") ${FAKE_DAEMON}
else if (cmd === "start") {
  mkdirSync(join(root, ".git/squeal"), { recursive: true });
  if (!process.env.FAKE_INHERITED) writeFileSync(join(root, ".git/squeal/store.sqlite"), "store");
  const d = spawn(process.execPath, [fileURLToPath(import.meta.url), "daemon", root], { detached: true, stdio: "ignore" });
  d.unref();
  writeFileSync(pidFile, String(d.pid));
  appendFileSync(join(process.env.FAKE_LOG, "daemons"), d.pid + "\\n");
} else if (cmd === "stop") {
  try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM"); } catch {}
  console.log("stopped");
} else if (cmd === "status") process.stdout.write(rest.includes("--json") ? (process.env.FAKE_INHERITED ? ${JSON.stringify(INHERITED_JSON)} : ${JSON.stringify(STATUS_JSON)}) : "Known failures: 0\\n");
else console.log("Known failures: 0");
`;

// The harness: --version answers; otherwise FAKE_HARNESS picks what the "session" does. A judge
// call (claudeRunner, its HOME in a squeal-judge-* scratch) logs its pid first; FAKE_JUDGE=hang
// keeps it running, its shell and a child of its own both ignoring SIGTERM (006-98).
const FAKE_HARNESS = `#!/bin/sh
case "$HOME" in */squeal-judge-*)
  echo $$ >> "$FAKE_LOG/judge"
  if [ "$FAKE_JUDGE" = hang ]; then
    trap '' TERM
    sh -c 'trap "" TERM; echo $$ >> "$FAKE_LOG/judge"; while :; do sleep 1; done' &
    while :; do sleep 1; done
  fi ;;
esac
[ "$1" = "--version" ] && { echo "fake 1.0"; exit 0; }
echo $$ >> "$FAKE_LOG/harness"
case "$FAKE_HARNESS" in
leak)
  echo '{"type":"system","subtype":"init","model":"m"}'
  echo "{\\"type\\":\\"result\\",\\"result\\":\\"TESTS: pass, key $ANTHROPIC_AUTH_TOKEN\\"}"
  echo "token $ANTHROPIC_AUTH_TOKEN" > leak.txt
  printf 'bin\\000%s' "$ANTHROPIC_AUTH_TOKEN" > leak.bin
  git add -A >/dev/null 2>&1; git commit -qm leak >/dev/null 2>&1 ;;
locked)
  mkdir locked; echo "$ANTHROPIC_AUTH_TOKEN" > locked/leak.txt; chmod 444 locked/leak.txt; chmod 555 locked ;;
squeal)
  squeal --version >> "$FAKE_LOG/bare" 2>&1 ;;
args)
  printf '%s\\n' "$@" > "$FAKE_LOG/args" ;;
start)
  node scripts/rates-service.mjs > /dev/null 2>&1 ;;
hang)
  trap '' TERM
  # Its own shell, as a subshell's $$ is its parent's: both pids are logged (006-95).
  sh -c 'trap "" TERM; echo $$ >> "$FAKE_LOG/harness"; while :; do sleep 1; done' &
  while :; do sleep 1; done ;;
esac
exit 0
`;

const FAKE_CODEX = `#!/bin/sh
[ "$1" = "--version" ] && { echo "fake 1.0"; exit 0; }
echo "cannot reach https://${HOST}/v1 with $FAKEPROXY_API_KEY" >&2
exit 9
`;

// Each start logs its pid (006-97: a teardown starts no ground truth).
const FAKE_NPX = `#!/bin/sh
echo $$ >> "$FAKE_LOG/npx"
for a in "$@"; do case $a in --outputFile=*) echo '{"numFailedTests":0,"testResults":[]}' > "\${a#--outputFile=}";; esac; done
exit 0
`;

export interface FakeRoot {
  dir: string;
  root: string;
  log: string;
  env: Record<string, string>;
  commit: string;
}

/** A scratch evals root seeded so run-cell builds nothing from the network or the real plugins. */
export function fakeRoot(): FakeRoot {
  const dir = mkdtempSync(join(tmpdir(), "squeal-evals-cell-"));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  const root = join(dir, "root");
  const base = join(root, "pin-base", commit);
  write(join(base, ".done"), `${commit}\n`);
  write(join(base, ".agents/plugins/marketplace.json"), '{ "name": "squeal" }\n');
  write(join(base, "plugins/claude-code/.claude-plugin/plugin.json"), '{ "version": "0.0.0" }\n');
  for (const p of ["claude-code", "codex"])
    write(join(base, "plugins", p, "dist/cli/squeal.mjs"), FAKE_SQUEAL);
  // The plugins' own `squeal`s, which a cell's PATH starts with (006-62).
  for (const [p, f] of [
    ["claude-code", "squeal"],
    ["codex", "squeal-launcher"],
  ] as const)
    write(
      join(base, "plugins", p, "bin", f),
      readFileSync(join(REPO, "plugins", p, "bin", f), "utf8"),
      0o755,
    );
  write(join(root, "nm/.done"), "");
  mkdirSync(join(root, "nm/node_modules"), { recursive: true });
  const bin = join(dir, "bin");
  write(join(bin, "claude"), FAKE_HARNESS, 0o755);
  write(join(bin, "codex"), FAKE_CODEX, 0o755);
  write(join(bin, "npx"), FAKE_NPX, 0o755);
  // The host's terminal launcher (spec 005 D3), first on the host's PATH as on this host.
  const hostBin = join(dir, "home/.local/bin");
  write(join(hostBin, "squeal"), '#!/bin/sh\necho "host launcher"\nexit 1\n', 0o755);
  mkdirSync(join(dir, "node"));
  symlinkSync(process.execPath, join(dir, "node/node"));
  write(
    join(dir, "home/.codex/config.toml"),
    [
      'model_provider = "fakeproxy"',
      "[model_providers.fakeproxy]",
      'name = "Fake"',
      `base_url = "https://${HOST}/v1"`,
      'env_key = "FAKEPROXY_API_KEY"',
    ].join("\n"),
  );
  const log = join(dir, "log");
  mkdirSync(log);
  const start = startOf(process.pid);
  const env = {
    PATH: `${hostBin}:${bin}:${join(dir, "node")}:/usr/bin:/bin`,
    HOME: join(dir, "home"),
    SQ_EVALS_ROOT: root,
    ANTHROPIC_AUTH_TOKEN: TOKEN,
    FAKEPROXY_API_KEY: PROXY_KEY,
    FAKE_LOG: log,
    // The test process, by its start time: its cells' fake daemons end with it (FAKE_DAEMON).
    ...(start === null ? {} : { FAKE_OWNER: `${process.pid}:${start}` }),
  };
  return { dir, root, log, env, commit };
}

export interface CellRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}

/**
 * Runs run-cell.mjs; `onStart` gets the child once it is spawned (to signal it). With
 * `--force-root`: the fake root sits under the system temp directory, inside the checkout in a
 * Cezar session, and its fake harnesses read no instructions (006-42).
 */
export function runCell(
  f: FakeRoot,
  args: string[],
  extraEnv: Record<string, string> = {},
  onStart?: (child: ReturnType<typeof spawn>) => void,
): Promise<CellRun> {
  const child = spawn(
    process.execPath,
    [join(REPO, "evals/bin/run-cell.mjs"), ...args, "--max-load", "100000", "--force-root"],
    { env: { ...f.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));
  onStart?.(child);
  return new Promise((resolve) =>
    child.on("close", (code, signal) => resolve({ code, signal, output })),
  );
}

/**
 * Tears a fake root down (014-32): kills the processes it owns (`cellProcesses`), its runner, its
 * session and its fake daemons whatever their logs hold, then removes it, a locked cell too.
 */
export function removeRoot(f: FakeRoot): void {
  for (const p of cellProcesses(f)) killCellProcess(p);
  if (existsSync(f.dir)) execFileSync("chmod", ["-R", "u+w", f.dir]);
  rmSync(f.dir, { recursive: true, force: true });
}

/** Every cell directory under the root: `cells/<commit>/<run>/<id>`. */
export function cellDirs(f: FakeRoot): string[] {
  const top = join(f.root, "cells", f.commit.slice(0, 12));
  if (!existsSync(top)) return [];
  return readdirSync(top).flatMap((run) =>
    readdirSync(join(top, run)).map((id) => join(top, run, id)),
  );
}

/** Files under `dir` holding any made-up secret: relative paths. */
export function leaks(dir: string): string[] {
  const out: string[] = [];
  const visit = (p: string) => {
    const st = statSync(p);
    if (st.isDirectory()) for (const e of readdirSync(p)) visit(join(p, e));
    else if ([TOKEN, PROXY_KEY, HOST].some((s) => readFileSync(p, "latin1").includes(s)))
      out.push(p.slice(dir.length + 1));
  };
  if (existsSync(dir)) visit(dir);
  return out;
}

/**
 * The pid logs: the fake daemons, the harness's processes, `npx`, a node:test probe's (006-97)
 * and the judge's (006-98).
 */
export type PidLog = "daemons" | "harness" | "npx" | "node-test" | "judge";

export const pids = (f: FakeRoot, name: PidLog): number[] =>
  existsSync(join(f.log, name))
    ? readFileSync(join(f.log, name), "utf8").split("\n").filter(Boolean).map(Number)
    : [];

/** A process as `/proc/<pid>` reads it, with its process group; `null` once it is gone. */
export interface ProcessReading {
  pid: number;
  state: string;
  ppid: number;
  pgid: number;
  args: string;
}

export function readProcess(pid: number): ProcessReading | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const [state = "?", ppid, pgrp] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    let args = "";
    try {
      args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
    } catch {
      // It ended after the stat was read.
    }
    return { pid, state, ppid: Number(ppid), pgid: Number(pgrp), args };
  } catch {
    return null;
  }
}

/** A process that exists and is not a zombie: a killed process waits as one until it is reaped. */
export const alive = (pid: number) => {
  const p = readProcess(pid);
  if (p) return p.state !== "Z" && p.state !== "X";
  // Gone, or no `/proc`: only then does the signal decide. The other order read a zombie reaped
  // between the signal and the read as alive (006-95).
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The pids the `names` logs hold that are still `alive`, each with its log and process (006-95). */
export const survivors = (f: FakeRoot, names: PidLog[]) =>
  names.flatMap((log) =>
    pids(f, log)
      .filter(alive)
      .map((pid) => ({ log, ...(readProcess(pid) ?? { pid }) })),
  );
