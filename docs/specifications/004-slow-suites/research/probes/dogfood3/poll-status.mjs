// Polls `squeal status` in a worktree every N seconds and prints one line per poll:
// load per CPU, revision, counts, slow pending, the slow-tier line of the text status
// and the published slow activity, or why status was unavailable. Read only.
// Usage: node poll-status.mjs <squeal.mjs | plugin cache dir> <root> <interval s> <max s>
// Given the plugin cache dir (holding one directory per version), each poll uses the newest
// installed version's CLI, since the marketplace auto-update replaces it mid-run.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";

const [cliArg, root, every, max] = process.argv.slice(2);
const newest = () => {
  if (cliArg.endsWith(".mjs")) return cliArg;
  const v = readdirSync(cliArg).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  return `${cliArg}/${v}/dist/cli/squeal.mjs`;
};
process.stdout.on("error", () => process.exit(0));
const end = Date.now() + Number(max) * 1000;
const run = (args) =>
  spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", newest(), ...args], { cwd: root, encoding: "utf8" });
let last = "";
for (;;) {
  const t = new Date().toISOString().slice(11, 19);
  const load = (loadavg()[0] / availableParallelism()).toFixed(2);
  const r = run(["status", "--json"]);
  let j;
  try { j = JSON.parse(r.stdout); } catch { j = undefined; }
  let line;
  if (!j?.available) {
    line = `unavailable: ${j?.reason ?? ""} ${j?.message ?? r.stderr.trim().split("\n")[0]}`;
  } else {
    const b = j.breakdown;
    const text = run(["status"]).stdout;
    const slowLine = text.split("\n").find((l) => /slow tier|slow file/i.test(l)) ?? "-";
    line =
      `r${j.revision} pass=${b.currentByOutcome.pass} fail=${b.currentByOutcome.fail} queued=${b.pendingByPhase.queued} ` +
      `running=${b.pendingByPhase.running} known=${j.knownFailures.length} slowPending=${JSON.stringify(j.slowPending ?? null)} ` +
      `slowTier=${JSON.stringify(j.slowTier ?? null)} | ${slowLine.trim()}`;
  }
  // The daemon's plugin version, from its process path, in case the plugin changes under us.
  const ps = spawnSync("pgrep", ["-af", `squeal.mjs daemon ${root}( |$)`], { encoding: "utf8" }).stdout.trim();
  const daemon = ps === "" ? "none" : ps.split("\n").map((l) => `${l.split(" ")[0]}@${(/hearsay\/squeal\/([^/]+)\/dist/.exec(l)?.[1] ?? (/squeal-dogfood3-/.test(l) ? "checkout" : "?"))}`).join(",");
  line = `daemon=${daemon} ${line}`;
  // One line per change, plus a heartbeat each minute, keeps the log readable.
  if (line !== last || t.endsWith(":00") || t.endsWith(":01")) console.log(`${t} load/cpu=${load} ${line}`);
  last = line;
  if (Date.now() > end) process.exit(1);
  await new Promise((res) => setTimeout(res, Number(every) * 1000));
}
