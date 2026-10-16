// Throwaway (research issue-17, question 3). Prints one line every 2 s: what
// `squeal status --json` says of the runner listing and the queue, and whether
// the store lists <new test file>. Ends when the new file has a key and is not
// pending, or after <max ms>.
// usage: node poll.mjs <fixture dir> <t0 epoch ms> <max ms> <new test file path>
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
const [dir, t0s, maxs, newFile] = process.argv.slice(2);
const t0 = Number(t0s);
const max = Number(maxs);
for (;;) {
  const s = JSON.parse(execFileSync("squeal", ["status", "--json"], { cwd: dir, encoding: "utf8" }));
  const db = new DatabaseSync(`${dir}/.git/squeal/store.sqlite`, { readOnly: true });
  const row = db.prepare("select key is not null as keyed, pending from test_file_keys where path = ?").get(newFile);
  const runs = db.prepare("select test_files, started_at from runs where ended_at is null").all();
  db.close();
  const running = runs.map((r) => `${JSON.parse(r.test_files).map((f) => f.path).join("+")}@${r.started_at - t0}`);
  const at = Date.now() - t0;
  const b = s.breakdown;
  console.log(
    `+${String(at).padStart(6)} ms rev ${s.revision} refined ${s.refinedRevision} runnerPartPending ${s.runnerPartPending}` +
      ` checks queued ${b.pendingByPhase.queued} running ${b.pendingByPhase.running}` +
      ` filesWithoutChecks ${JSON.stringify(s.testFilesWithoutChecks)} slowActivity ${JSON.stringify(s.slowTier.activity)}` +
      ` ${newFile}: ${row === undefined ? "not listed" : `keyed ${row.keyed} pending ${row.pending}`}` +
      ` openRuns [${running.join(", ")}]`,
  );
  if ((row !== undefined && row.keyed === 1 && row.pending === null) || at > max) break;
  await sleep(2000);
}
