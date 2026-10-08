// Polls `squeal status --json` in a worktree every N seconds and prints one line per poll:
// revision, counts, files without checks, full-suite state, or why status was unavailable.
// Usage: node poll-status.mjs <squeal.mjs> <root> <interval s> <max s> [--until-full-suite]
// Exits 0 when --until-full-suite and a full-suite checkpoint has completed, else at max.
import { spawnSync } from "node:child_process";

const [cli, root, every, max] = process.argv.slice(2);
process.stdout.on("error", () => process.exit(0));
const untilFull = process.argv.includes("--until-full-suite");
const end = Date.now() + Number(max) * 1000;
for (;;) {
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, "status", "--json"], { cwd: root, encoding: "utf8" });
  const t = new Date().toISOString().slice(11, 19);
  let j;
  try { j = JSON.parse(r.stdout); } catch { j = undefined; }
  if (!j?.available) {
    console.log(`${t} unavailable: ${j?.reason ?? ""} ${j?.message ?? r.stderr.trim().split("\n")[0]}`);
  } else {
    const b = j.breakdown;
    console.log(
      `${t} r${j.revision} pass=${b.currentByOutcome.pass} fail=${b.currentByOutcome.fail} queued=${b.pendingByPhase.queued} running=${b.pendingByPhase.running} ` +
        `files=${b.testFiles} withoutChecks=${b.testFilesWithoutChecks} known=${j.knownFailures.length} full=${JSON.stringify(j.fullSuite)}`,
    );
    if (untilFull && j.fullSuite.lastCompletedRevision !== null) process.exit(0);
  }
  if (Date.now() > end) process.exit(1);
  await new Promise((res) => setTimeout(res, Number(every) * 1000));
}
