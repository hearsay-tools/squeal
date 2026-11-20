#!/usr/bin/env node
// Throwaway probe for 023-28 (023-10's session.mjs for the lab VM). Not product code. Runs one
// dogfood session as squeal-w17, on the clone `sh setup.sh prepare <id>` made:
//
//   node session.mjs <id>        (id: s<g>-<nn>; the prompt is prompts.json's s<g>)
//
// Before and after: the clone's HEAD, status, stash list, reflog and worktrees, the load, the
// user's processes and Squeal's checkouts. The session: `timeout 1200 claude -p --model sonnet`
// with stream-json and hook events, credentials by name only (ANTHROPIC_BASE_URL,
// ANTHROPIC_AUTH_TOKEN). After it: `squeal ps`, `squeal stop` in the clone, then the transcript
// Claude Code wrote is copied out with every credential value of this environment, the API base
// URL and the machine's host name replaced. Logs go to <work>/logs/<id>/.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const U = "squeal-w17";
const R = `/home/${U}/runs/w17`;
const id = process.argv[2] ?? "";
const group = /^(s[127])-\d\d$/.exec(id)?.[1];
const prompts = JSON.parse(readFileSync(join(here, "prompts.json"), "utf8"));
if (!group || !prompts[group]) throw new Error(`no prompt for ${id}`);
const clone = `${R}/${id}`;
const out = join(dirname(here), "logs", id);
mkdirSync(out, { recursive: true });

const secretNames = [
  "ANTHROPIC_AUTH_TOKEN",
  "CLIPROXY_API_KEY",
  "GH_TOKEN",
  "AGENT_VAULT_TOKEN",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "OPENCLAW_PROXY_URL",
  "STARSHIP_SESSION_KEY",
];
const replace = [
  ...secretNames.map((n) => [process.env[n], "[redacted]"]),
  [process.env.ANTHROPIC_BASE_URL, "[api-base-url]"],
  [hostname(), "[vm]"],
].filter(([v]) => typeof v === "string" && v.length >= 6);
const redact = (text) => replace.reduce((t, [s, r]) => t.split(s).join(r), text);

const as = (cwd, cmd, args, extra = {}) => {
  try {
    return execFileSync("node", [join(here, "as-user.mjs"), R, cwd, cmd, ...args], {
      cwd: "/",
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, ...extra },
      timeout: 120_000,
    });
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}[exit ${e.status}]`;
  }
};
const load = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const processes = () => {
  try {
    return execFileSync("ps", ["-u", U, "-o", "pid,ppid,etime,args"], { encoding: "utf8" });
  } catch (e) {
    return `${e.stdout ?? ""}(none)`;
  }
};
const snapshot = (name) => {
  const parts = [
    ["head", as(clone, "git", ["rev-parse", "HEAD"])],
    ["branch", as(clone, "git", ["branch", "--show-current"])],
    ["status", as(clone, "git", ["status", "--porcelain=v1", "--untracked-files=all"])],
    ["stash", as(clone, "git", ["stash", "list"])],
    ["reflog", as(clone, "git", ["reflog", "-n", "30", "--date=iso"])],
    ["worktrees", as(clone, "git", ["worktree", "list", "--porcelain"])],
    ["checkouts", as(R, "sh", ["-c", "ls -la home/.cache/squeal/checkouts/* 2>&1 || true"])],
    ["processes", processes()],
  ];
  writeFileSync(join(out, `${name}.txt`), redact(parts.map(([k, v]) => `## ${k}\n${v}`).join("\n")));
};

snapshot("before");
const meta = {
  id,
  group,
  clone,
  prompt: prompts[group],
  start: new Date().toISOString(),
  loadStart: load(),
  cpus: cpus().length,
};
const stream = createWriteStream(join(out, "stream.jsonl"));
const errs = createWriteStream(join(out, "stderr.txt"));
const t0 = Date.now();
const child = spawn(
  "node",
  [
    join(here, "as-user.mjs"),
    R,
    clone,
    "timeout",
    "--kill-after=30",
    "1200",
    "claude",
    "-p",
    "--model",
    "sonnet",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-hook-events",
    "--permission-mode",
    "bypassPermissions",
    prompts[group],
  ],
  {
    cwd: "/",
    env: {
      PATH: process.env.PATH,
      E2E_PRESERVE: "ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN",
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    stream.write(`${JSON.stringify({ t: (Date.now() - t0) / 1000 })}\t${redact(line)}\n`);
  }
});
child.stderr.on("data", (d) => errs.write(redact(d.toString())));
const code = await new Promise((r) => child.on("exit", (c, s) => r(c ?? s)));
meta.exit = code;
meta.wallSeconds = (Date.now() - t0) / 1000;
meta.end = new Date().toISOString();
meta.loadEnd = load();
stream.end();
errs.end();

snapshot("after-session");
writeFileSync(join(out, "squeal-ps.txt"), redact(as(clone, "squeal", ["ps"])));
writeFileSync(join(out, "squeal-stop.txt"), redact(as(clone, "squeal", ["stop"])));
snapshot("after-stop");
// The transcript Claude Code kept for the session, copied out with credentials replaced.
const slug = clone.replace(/[^a-zA-Z0-9]/g, "-");
const list = as(R, "sh", ["-c", `ls -t claude/projects/${slug}/*.jsonl 2>/dev/null | head -1`]).trim();
if (list && !list.includes("[exit")) {
  meta.transcript = `${R}/${list}`;
  writeFileSync(join(out, "transcript.jsonl"), redact(as(R, "cat", [list])));
}
writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify(meta));
