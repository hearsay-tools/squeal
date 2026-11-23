#!/usr/bin/env node
// Throwaway probe for 023-63 (023-28's session.mjs, on the lab VM). Not product code.
// Runs one dogfood session as squeal-w31, on the clone `sh setup.sh prepare <id>` made:
//
//   node session.mjs <id>        (id: s<g>-<nn>; the prompt is prompts.json's s<g>)
//
// Before and after: the clone's HEAD, status, stash list, reflog and worktrees, the load, the
// user's processes and Squeal's checkouts. The session: `timeout 1200 claude -p --model sonnet`
// with stream-json and hook events, credentials by name only (ANTHROPIC_BASE_URL,
// ANTHROPIC_AUTH_TOKEN). After it: `squeal ps`, `squeal stop` in the clone, then the transcript
// Claude Code wrote is copied out with every credential value of this environment, the API base
// URL and the machine's host name replaced. Logs go to <work>/logs/<id>/.
// For R6 (023-44): 5 s after `squeal stop`, every process of the user whose cwd or command line
// lies under the clone or under its folder in Squeal's checkouts cache is written to
// leftover.txt and counted in meta.json (`leftover`), then ended (TERM, then KILL after 5 s), so
// it cannot load the next session.
// For round 6 (023-44): before that, the commit daemons and commit worktrees the session left are
// recorded (commit-left.txt) and stopped with `squeal stop --at HEAD~1` and `--at HEAD`.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const U = "squeal-w31";
const R = `/home/${U}/runs/w31`;
const id = process.argv[2] ?? "";
const group = /^(s[12])-\d\d$/.exec(id)?.[1];
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
// Round 6 (023-44): commit daemons (spec 023 D7) outlive `squeal stop` by design and finish their
// queue. Record what this session left (squeal ps, and the commit worktrees in its checkout
// folders), then stop them with `squeal stop --at` for HEAD and HEAD~1, so they cannot load the
// next session. meta.commitStop keeps each stop's exit line.
const cacheDir = `${R}/home/.cache/squeal/checkouts/${createHash("sha256").update(`${clone}/.git`).digest("hex").slice(0, 16)}`;
const trees = () => as(R, "sh", ["-c", `ls -la ${cacheDir} ${clone}/.git/squeal/checkouts home/.cache/squeal/checkouts/commit-places 2>&1 || true`]);
writeFileSync(join(out, "commit-left.txt"), redact(`## squeal ps after squeal stop\n${as(clone, "squeal", ["ps"])}\n## checkout folders\n${trees()}`));
meta.commitStop = {};
for (const rev of ["HEAD~1", "HEAD"]) meta.commitStop[rev] = redact(as(clone, "squeal", ["stop", "--at", rev])).trim().split("\n").slice(-3).join(" | ");
writeFileSync(join(out, "commit-after-stop-at.txt"), redact(`## squeal ps\n${as(clone, "squeal", ["ps"])}\n## checkout folders\n${trees()}`));
// R6: processes of this session left after it ended and its daemon stopped.
await new Promise((r) => setTimeout(r, 5_000));
const checkouts = `${R}/home/.cache/squeal/checkouts/${createHash("sha256").update(`${clone}/.git`).digest("hex").slice(0, 16)}`;
const mine = (path) => path === clone || path.startsWith(`${clone}/`) || path.startsWith(checkouts);
const left = [];
for (const pid of execFileSync("sh", ["-c", `pgrep -u ${U} || true`], { encoding: "utf8" }).split("\n").filter(Boolean)) {
  const read = (cmd) => {
    try {
      return execFileSync("sudo", ["-n", ...cmd], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  const cwd = read(["readlink", `/proc/${pid}/cwd`]);
  const args = read(["cat", `/proc/${pid}/cmdline`]).split("\0").join(" ").trim();
  if (mine(cwd.replace(/ \(deleted\)$/, "")) || args.includes(`${clone}/`) || args.includes(checkouts)) left.push({ pid, cwd, args });
}
meta.leftover = left.length;
writeFileSync(
  join(out, "leftover.txt"),
  redact(left.map((p) => `${p.pid}\t${p.cwd}\t${p.args.slice(0, 300)}`).join("\n") + `\n${left.length} processes\n`),
);
if (left.length > 0) {
  const pids = left.map((p) => p.pid);
  execFileSync("sh", ["-c", `sudo -n kill -TERM ${pids.join(" ")} 2>/dev/null; sleep 5; sudo -n kill -KILL ${pids.join(" ")} 2>/dev/null || true`]);
}
// The transcript Claude Code kept for the session, copied out with credentials replaced.
const slug = clone.replace(/[^a-zA-Z0-9]/g, "-");
const list = as(R, "sh", ["-c", `ls -t claude/projects/${slug}/*.jsonl 2>/dev/null | head -1`]).trim();
if (list && !list.includes("[exit")) {
  meta.transcript = `${R}/${list}`;
  writeFileSync(join(out, "transcript.jsonl"), redact(as(R, "cat", [list])));
}
writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify(meta));
