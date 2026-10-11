// The subject session (spec 006 D3): the harness's command at an explicit effort level, every
// JSON line timestamped, the load average every 5 s, in a process group a deadline can end;
// then the ground truth's two commands, bounded the same way.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";

/**
 * 001's dogfooding allow-list for Claude Code subjects, with `Bash(node:*)` for the fixture's
 * scripts: 005-06's `Bash(node --test:*)` refused `node scripts/changelog.mjs` (open question 3).
 */
export const CLAUDE_ALLOWED_TOOLS = [
  "Bash(git:*)",
  "Bash(grep:*)",
  "Bash(ls:*)",
  "Bash(cat:*)",
  "Bash(npx vitest:*)",
  "Bash(npm test:*)",
  "Bash(npm run:*)",
  "Bash(node:*)",
  "Bash(squeal:*)",
  "Bash(sleep:*)",
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
];

/** `[command, args]` for one session; `pluginDir` is the Claude Code plugin, or `null` for none. */
export function sessionCommand({ harness, prompt, model, effort, pluginDir }) {
  if (harness === "codex") {
    return [
      "codex",
      [
        "exec",
        "--json",
        "-s",
        "danger-full-access",
        "-m",
        model,
        "-c",
        `model_reasoning_effort="${effort}"`,
        prompt,
      ],
    ];
  }
  return [
    "claude",
    [
      ...["-p", prompt, "--model", model, "--effort", effort],
      ...["--output-format", "stream-json", "--verbose", "--include-hook-events"],
      ...[
        "--setting-sources",
        "project",
        "--strict-mcp-config",
        "--permission-mode",
        "acceptEdits",
      ],
      ...(pluginDir ? ["--plugin-dir", pluginDir] : []),
      "--allowedTools",
      ...CLAUDE_ALLOWED_TOOLS,
    ],
  ];
}

const running = new Set();

/**
 * Runs `command` in its own process group, so a timeout or a teardown reaches every process it
 * started. At `timeoutMs` the group gets SIGTERM, `graceMs` later SIGKILL, and `graceMs` after
 * that the wait ends whatever the pipes say. `onStdout` and `onStderr` take chunks. Returns
 * `{ exit, signal, timedOut, spawnError }`: `exit` is null unless the process exited by itself,
 * `spawnError` the error code of a command that could not start (`ENOENT`, `EACCES`).
 */
export function runBounded({
  command,
  args,
  cwd,
  env,
  timeoutMs,
  graceMs = 10_000,
  onStdout,
  onStderr,
  log,
}) {
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const timers = [];
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const group = { kill: (sig) => signalGroup(child.pid, sig) };
    const done = (r) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      running.delete(group);
      // Whatever the session left in its group goes with it.
      if (!r.spawnError) group.kill("SIGKILL");
      resolve({ exit: null, signal: null, timedOut, spawnError: null, ...r });
    };
    child.on("error", (e) => done({ spawnError: e.code ?? e.message }));
    if (child.pid === undefined) return;
    running.add(group);
    child.stdout.on("data", (d) => onStdout?.(d));
    child.stderr.on("data", (d) => onStderr?.(d));
    child.on("close", (code, signal) => done({ exit: code, signal }));
    timers.push(
      setTimeout(() => {
        timedOut = true;
        log(`timeout after ${timeoutMs} ms: SIGTERM to the process group`);
        group.kill("SIGTERM");
        timers.push(
          setTimeout(() => {
            log(`still running ${graceMs} ms later: SIGKILL to the process group`);
            group.kill("SIGKILL");
            timers.push(
              setTimeout(() => {
                child.stdout.destroy();
                child.stderr.destroy();
                done({ signal: child.signalCode ?? "SIGKILL" });
              }, graceMs),
            );
          }, graceMs),
        );
      }, timeoutMs),
    );
  });
}

function signalGroup(pid, sig) {
  try {
    process.kill(-pid, sig);
  } catch {
    // The group is gone.
  }
}

/** Sends `signal` to every process group `runBounded` is still waiting for: a runner's teardown. */
export function killRunning(signal = "SIGKILL") {
  for (const g of running) g.kill(signal);
}

/**
 * Runs the session in `cwd` with `env`, writing `events.jsonl`, `stderr.txt`, `load.tsv`, `t0`
 * and `t1` to `out`. Returns `{ exit, t0, t1, samples }`: `exit` is `runBounded`'s record,
 * `samples` are one-minute loads.
 */
export async function runSession({ command, args, cwd, env, out, timeoutS, graceS = 10, log }) {
  const samples = [];
  const sample = () => {
    const l = loadavg();
    samples.push(l[0]);
    appendFileSync(
      join(out, "load.tsv"),
      `${Date.now()}\t${l.map((x) => x.toFixed(2)).join("\t")}\n`,
    );
  };
  const t0 = Date.now();
  writeFileSync(join(out, "t0"), String(t0));
  sample();
  const timer = setInterval(sample, 5000);
  let buf = "";
  const exit = await runBounded({
    command,
    args,
    cwd,
    env,
    timeoutMs: timeoutS * 1000,
    graceMs: graceS * 1000,
    log,
    onStdout: (d) => {
      buf += d;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let v;
        try {
          v = JSON.parse(line);
        } catch {
          v = { raw: line };
        }
        appendFileSync(
          join(out, "events.jsonl"),
          `${JSON.stringify({ t: Date.now() - t0, ...v })}\n`,
        );
      }
    },
    onStderr: (d) => appendFileSync(join(out, "stderr.txt"), d),
  });
  clearInterval(timer);
  sample();
  const t1 = Date.now();
  writeFileSync(join(out, "t1"), String(t1));
  return { exit, t0, t1, samples };
}

/**
 * The ground truth after the session (spec 006 goal 2), in `cwd`: Vitest's JSON report to
 * `out/truth.vitest.json`, `node --test` over `scripts/*.test.mjs` to `out/truth.node.txt`, and
 * both commands' completion to `out/truth.json`, `{ vitest, nodeTest }` with `nodeTest.files`.
 * No `node:test` file leaves `nodeTest.exit` null: nothing ran, so nothing passed.
 */
export async function groundTruth({
  cwd,
  env,
  out,
  log,
  timeoutMs = 180_000,
  graceMs = 10_000,
  npx = "npx",
}) {
  const vitest = await runBounded({
    command: npx,
    args: ["vitest", "run", "--reporter=json", `--outputFile=${join(out, "truth.vitest.json")}`],
    cwd,
    env: { ...env, LEDGERLINE_CALENDAR_WARM: "1" },
    timeoutMs,
    graceMs,
    log,
  });
  const scripts = join(cwd, "scripts");
  const files = existsSync(scripts)
    ? readdirSync(scripts)
        .filter((f) => f.endsWith(".test.mjs"))
        .map((f) => `scripts/${f}`)
    : [];
  let text = "";
  const nodeTest = files.length
    ? await runBounded({
        command: process.execPath,
        args: ["--test", ...files],
        cwd,
        env,
        timeoutMs: Math.min(timeoutMs, 60_000),
        graceMs,
        log,
        onStdout: (d) => (text += d),
        onStderr: (d) => (text += d),
      })
    : { exit: null, signal: null, timedOut: false, spawnError: null };
  writeFileSync(join(out, "truth.node.txt"), text);
  const truth = { vitest, nodeTest: { ...nodeTest, files: files.length } };
  writeFileSync(join(out, "truth.json"), `${JSON.stringify(truth, null, 2)}\n`);
  return truth;
}
