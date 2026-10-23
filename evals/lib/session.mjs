// The subject session (spec 006 D3): the harness's command at an explicit effort level, every
// JSON line timestamped, the load average every 5 s, in a process group a deadline can end;
// then the ground truth's two commands, bounded the same way.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";

/**
 * 001's dogfooding allow-list for Claude Code subjects, with `Bash(node:*)` for the fixture's
 * scripts: 005-06's `Bash(node --test:*)` refused `node scripts/changelog.mjs` (open question 3).
 * `Skill` lets a subject load the plugin's skill, which `-p` refuses without a rule, as the Agent
 * SDK allows it (001-280's research; 2026-10-12). Run conditions name this list (D6).
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
  "Skill",
];

/**
 * `[command, args]` for one session; `pluginDir` is the Claude Code plugin, or `null` for none.
 * `tools` are the cell's own rules after `CLAUDE_ALLOWED_TOOLS`, from its knobs (`knobTools`).
 * A second turn (006-33) resumes the first's session: `resume` is its id, Claude Code's
 * `sessionId` that turn 1 named, or the thread Codex's turn 1 started. Codex's `exec resume`
 * takes no `-s`, so it names the sandbox through its config.
 */
export function sessionCommand({
  harness,
  prompt,
  model,
  effort,
  pluginDir,
  sessionId = null,
  resume = null,
  tools = [],
}) {
  if (harness === "codex") {
    const pinned = ["-m", model, "-c", `model_reasoning_effort="${effort}"`];
    if (resume)
      return [
        "codex",
        [
          ...["exec", "resume", "--json", ...pinned],
          ...["-c", 'sandbox_mode="danger-full-access"', resume, prompt],
        ],
      ];
    return ["codex", ["exec", "--json", "-s", "danger-full-access", ...pinned, prompt]];
  }
  return [
    "claude",
    [
      ...["-p", prompt, "--model", model, "--effort", effort],
      ...(resume ? ["--resume", resume] : sessionId ? ["--session-id", sessionId] : []),
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
      ...tools,
    ],
  ];
}

const running = new Set();
let stopped = false;

/** Whether `killRunning`, a runner's teardown, has begun: no command starts after it (006-97). */
export const stopping = () => stopped;

/**
 * Runs `command` in its own process group, so a timeout or a teardown reaches every process it
 * started. At `timeoutMs` the group gets SIGTERM, `graceMs` later SIGKILL, and `graceMs` after
 * that the wait ends whatever the pipes say. `input`, when given, is written to its stdin, which
 * is otherwise closed (a judge call's transcript, 006-98). `onStdout` and `onStderr` take chunks.
 * Returns `{ exit, signal, timedOut, spawnError }`: `exit` is null unless the process exited by
 * itself, `spawnError` the error code of a command that could not start (`ENOENT`, `EACCES`), or
 * `stopping` for one not started because the teardown has begun (`killRunning`, 006-97).
 */
export function runBounded({
  command,
  args,
  cwd,
  env,
  timeoutMs,
  graceMs = 10_000,
  input,
  onStdout,
  onStderr,
  log,
}) {
  if (stopped) {
    log?.(`the teardown has begun: ${command} ${args[0] ?? ""} not started`);
    return Promise.resolve({ exit: null, signal: null, timedOut: false, spawnError: "stopping" });
  }
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const timers = [];
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const group = { pgid: child.pid, kill: (sig) => signalGroup(child.pid, sig) };
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
    if (input !== undefined) {
      child.stdin.on("error", () => {}); // A command that ends before it reads its input.
      child.stdin.end(input);
    }
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

/**
 * A runner's teardown: from now on `runBounded` starts nothing (006-97). Sends `signal` to every
 * process group `runBounded` is still waiting for, then waits up to `waitMs` until none of them
 * has a live process left and each one's `runBounded` has settled. A killed process stays
 * visible for a moment after the signal, and a zombie until it is reaped; only a process that is
 * not a zombie counts as live. Settled, the group's leader is reaped and whatever its end resumes
 * has run up to its next wait, so the runner reaps its session before it exits.
 */
export async function killRunning(signal = "SIGKILL", waitMs = 5_000) {
  const groups = killGroups(signal);
  const deadline = Date.now() + waitMs;
  while (groups.some((g) => running.has(g) || groupLive(g.pgid)) && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 50));
}

/** Sets the flag after which `runBounded` starts nothing; `signal` goes to each running group. */
function killGroups(signal) {
  stopped = true;
  const groups = [...running];
  for (const g of groups) g.kill(signal);
  return groups;
}

let onSignal = false;

/**
 * A judge script's answer to SIGINT and SIGTERM, installed once (006-98): every group
 * `runBounded` runs gets SIGKILL, and the script exits 128 + n once none has a live process, or
 * after `waitMs` whatever is live, naming on stderr each group that outlived the wait: a process
 * in uninterruptible sleep ends at SIGKILL only when its wait does. A judge call runs in a group
 * of its own, which a terminal's signal no longer reaches. The wait is synchronous: a killed
 * call's end resumes nothing, so the script writes no results from the calls refused after it.
 * `run-cell` has its own teardown and does not call it.
 */
export function stopOnSignal(waitMs = 5_000) {
  if (onSignal) return;
  onSignal = true;
  for (const [sig, n] of [
    ["SIGINT", 2],
    ["SIGTERM", 15],
  ])
    process.on(sig, () => {
      let live = killGroups("SIGKILL");
      const deadline = Date.now() + waitMs;
      const pause = new Int32Array(new SharedArrayBuffer(4));
      for (;;) {
        live = live.filter((g) => groupLive(g.pgid));
        if (!live.length || Date.now() >= deadline) break;
        Atomics.wait(pause, 0, 0, 20);
      }
      for (const g of live)
        console.error(`${sig}: process group ${g.pgid} still live ${waitMs} ms after SIGKILL`);
      process.exit(128 + n);
    });
}

/** Whether process group `pgid` has a process that is not a zombie; without `/proc`, any process. */
export function groupLive(pgid) {
  if (pgid === undefined) return false;
  let entries;
  try {
    entries = readdirSync("/proc");
  } catch {
    try {
      process.kill(-pgid, 0);
      return true;
    } catch {
      return false;
    }
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    let stat;
    try {
      stat = readFileSync(`/proc/${e}/stat`, "utf8");
    } catch {
      continue;
    }
    // After the command's closing parenthesis: state, ppid, pgrp, ...
    const [state, , pgrp] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(pgrp) === pgid && state !== "Z" && state !== "X") return true;
  }
  return false;
}

/**
 * Runs the session in `cwd` with `env`, writing `events.jsonl`, `stderr.txt`, `load.tsv`, `t0`
 * and `t1` to `out`. Returns `{ exit, t0, t1, samples }`: `exit` is `runBounded`'s record,
 * `samples` are one-minute loads. A later turn of the same session passes turn 1's `t0`: its
 * events land in the same timeline, timed from the session's start, and `t0` stays turn 1's.
 */
export async function runSession({
  command,
  args,
  cwd,
  env,
  out,
  timeoutS,
  graceS = 10,
  log,
  t0: start = null,
}) {
  const samples = [];
  const sample = () => {
    const l = loadavg();
    samples.push(l[0]);
    appendFileSync(
      join(out, "load.tsv"),
      `${Date.now()}\t${l.map((x) => x.toFixed(2)).join("\t")}\n`,
    );
  };
  const t0 = start ?? Date.now();
  if (start === null) writeFileSync(join(out, "t0"), String(t0));
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
 * No `node:test` file leaves `nodeTest.exit` null: nothing ran, so nothing passed. Once the
 * teardown has begun (`killRunning`) it writes neither file, and returns the records (006-98).
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
  const truth = { vitest, nodeTest: { ...nodeTest, files: files.length } };
  // After the teardown has begun the cell is not graded, and no file lands after its scan.
  if (stopped) return truth;
  writeFileSync(join(out, "truth.node.txt"), text);
  writeFileSync(join(out, "truth.json"), `${JSON.stringify(truth, null, 2)}\n`);
  return truth;
}
