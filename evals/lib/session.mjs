// The subject session (spec 006 D3): the harness's command at an explicit effort level, every
// JSON line timestamped, the load average every 5 s.
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
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

/**
 * Runs the session in `cwd` with `env`, writing `events.jsonl`, `stderr.txt`, `load.tsv`, `t0`
 * and `t1` to `out`. Returns `{ exit, t0, t1, samples }`; `samples` are one-minute loads.
 */
export async function runSession({ command, args, cwd, env, out, timeoutS, log }) {
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
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  child.stdout.on("data", (d) => {
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
  });
  child.stderr.on("data", (d) => appendFileSync(join(out, "stderr.txt"), d));
  const killer = setTimeout(() => {
    log("timeout: killing the session");
    child.kill("SIGTERM");
  }, timeoutS * 1000);
  const exit = await new Promise((resolve) =>
    child.on("close", (code, signal) => resolve({ code, signal })),
  );
  clearTimeout(killer);
  clearInterval(timer);
  sample();
  const t1 = Date.now();
  writeFileSync(join(out, "t1"), String(t1));
  return { exit, t0, t1, samples };
}
