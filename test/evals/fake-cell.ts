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
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TOKEN = "made-up-anthropic-token-0123456789abcdef";
export const PROXY_KEY = "made-up-proxy-key-0123456789abcdefghij";
export const HOST = "proxy.example.invalid";
export const STATUS_JSON = '{\n  "fake": true,\n  "knownFailures": 0\n}\n';

const REPO = join(import.meta.dirname, "../..");
const write = (p: string, s: string, mode?: number) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, s);
  if (mode) chmodSync(p, mode);
};

const FAKE_SQUEAL = `import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const [cmd, ...rest] = process.argv.slice(2);
const root = process.cwd();
const pidFile = join(root, ".git/squeal/fake.pid");
if (cmd === "daemon") setInterval(() => {}, 1000);
else if (cmd === "start") {
  mkdirSync(join(root, ".git/squeal"), { recursive: true });
  writeFileSync(join(root, ".git/squeal/store.sqlite"), "store");
  const d = spawn(process.execPath, [fileURLToPath(import.meta.url), "daemon", root], { detached: true, stdio: "ignore" });
  d.unref();
  writeFileSync(pidFile, String(d.pid));
  appendFileSync(join(process.env.FAKE_LOG, "daemons"), d.pid + "\\n");
} else if (cmd === "stop") {
  try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM"); } catch {}
  console.log("stopped");
} else if (cmd === "status") process.stdout.write(rest.includes("--json") ? ${JSON.stringify(STATUS_JSON)} : "Known failures: 0\\n");
else console.log("Known failures: 0");
`;

// The harness: --version answers; otherwise FAKE_HARNESS picks what the "session" does.
const FAKE_HARNESS = `#!/bin/sh
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
hang)
  trap '' TERM
  (trap '' TERM; echo $$ >> "$FAKE_LOG/harness"; while :; do sleep 1; done) &
  while :; do sleep 1; done ;;
esac
exit 0
`;

const FAKE_CODEX = `#!/bin/sh
[ "$1" = "--version" ] && { echo "fake 1.0"; exit 0; }
echo "cannot reach https://${HOST}/v1 with $FAKEPROXY_API_KEY" >&2
exit 9
`;

const FAKE_NPX = `#!/bin/sh
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
  write(join(root, "nm/.done"), "");
  mkdirSync(join(root, "nm/node_modules"), { recursive: true });
  const bin = join(dir, "bin");
  write(join(bin, "claude"), FAKE_HARNESS, 0o755);
  write(join(bin, "codex"), FAKE_CODEX, 0o755);
  write(join(bin, "npx"), FAKE_NPX, 0o755);
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
  const env = {
    PATH: `${bin}:${join(dir, "node")}:/usr/bin:/bin`,
    HOME: join(dir, "home"),
    SQ_EVALS_ROOT: root,
    ANTHROPIC_AUTH_TOKEN: TOKEN,
    FAKEPROXY_API_KEY: PROXY_KEY,
    FAKE_LOG: log,
  };
  return { dir, root, log, env, commit };
}

export interface CellRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}

/** Runs run-cell.mjs; `onStart` gets the child once it is spawned (to signal it). */
export function runCell(
  f: FakeRoot,
  args: string[],
  extraEnv: Record<string, string> = {},
  onStart?: (child: ReturnType<typeof spawn>) => void,
): Promise<CellRun> {
  const child = spawn(
    process.execPath,
    [join(REPO, "evals/bin/run-cell.mjs"), ...args, "--max-load", "100000"],
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

export const pids = (f: FakeRoot, name: "daemons" | "harness"): number[] =>
  existsSync(join(f.log, name))
    ? readFileSync(join(f.log, name), "utf8").split("\n").filter(Boolean).map(Number)
    : [];

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
