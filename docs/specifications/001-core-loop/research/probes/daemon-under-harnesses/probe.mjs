import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const since = Date.now() - 1_000; // as Cezar's holdersSince: workerProcessCutoff(createdAt)
const here = dirname(fileURLToPath(import.meta.url));
const CEZ = "/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/delegation/process-liveness.js";
const { processesWithCwdUnder } = await import(CEZ);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const ids = (pid) => {
  const s = readFileSync(`/proc/${pid}/stat`, "utf8"); const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
  return { pid, ppid: Number(f[1]), pgid: Number(f[2]), sid: Number(f[3]) };
};
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

console.log(`node ${process.version}, git ${git(here, "--version")}, probe pid ${process.pid} ${JSON.stringify(ids(process.pid))}`);

for (const variant of ["cwd=root (before 001-61)", "cwd=<common-dir>/squeal (after 001-61)"]) {
  const base = mkdtempSync(join(tmpdir(), "squeal-66-"));
  const repo = join(base, "repo"); mkdirSync(repo);
  git(repo, "init", "-q"); writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "."); git(repo, "-c", "user.name=p", "-c", "user.email=p@p", "commit", "-qm", "init");
  const wt = join(base, "wt"); git(repo, "worktree", "add", "-q", "--detach", wt);
  const scratch = join(base, "scratch"); mkdirSync(scratch);
  const storeDir = join(repo, ".git", "squeal"); mkdirSync(storeDir, { recursive: true });
  const daemonCwd = variant.startsWith("cwd=root") ? wt : storeDir;
  const out = join(base, "daemon.json");

  // The harness spawns its agent in its own group here, so the whole group can be killed.
  const controller = spawn(process.execPath, [join(here, "controller.mjs"), join(here, "hook.mjs"), join(here, "fake-daemon.mjs"), out, daemonCwd],
    { cwd: wt, env: { ...process.env, TMPDIR: scratch }, detached: true, stdio: "ignore" });
  for (let i = 0; i < 50 && !existsSync(out); i++) await sleep(50);
  await sleep(100);
  const d = JSON.parse(readFileSync(out, "utf8"));
  console.log(`\n## ${variant}`);
  console.log("controller", JSON.stringify(ids(controller.pid)), readFileSync(`/proc/${controller.pid}/cgroup`, "utf8").trim());
  console.log("daemon at start", JSON.stringify(d));
  console.log("daemon now    ", JSON.stringify(ids(d.pid)), "cwd", readlinkSync(`/proc/${d.pid}/cwd`));
  console.log("cezarion scan [wt, scratch] before teardown:", JSON.stringify(processesWithCwdUnder([wt, scratch], process.platform, undefined, since)));

  process.kill(-controller.pid, "SIGKILL");
  await sleep(300);
  console.log(`after SIGKILL to controller group ${controller.pid}: controller alive=${alive(controller.pid)}, daemon alive=${alive(d.pid)}`);
  console.log("cezarion scan [wt, scratch] after teardown:", JSON.stringify(processesWithCwdUnder([wt, scratch], process.platform, undefined, since)));

  let removed;
  try { git(repo, "worktree", "remove", wt); removed = "exit 0"; } catch (e) { removed = `failed: ${e.stderr}`; }
  console.log(`git worktree remove (no --force): ${removed}; dir exists=${existsSync(wt)}; daemon alive=${alive(d.pid)}; daemon cwd now ${readlinkSync(`/proc/${d.pid}/cwd`)}`);

  process.kill(d.pid, "SIGKILL");
  await sleep(100);
  rmSync(base, { recursive: true, force: true });
}
