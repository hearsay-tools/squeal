// Throwaway: one line per saved `why --json`, the facts issue 15 names.
// Usage: node summarize.mjs <out-dir>
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const [out] = process.argv.slice(2);
const wt = (root) => (root === null ? "?" : basename(root));
let ownRunLog = null;
let marker = null; // A's own temp directory, from its first run's error

for (const name of readdirSync(out).filter((f) => /^\d-why-.*\.json$/.test(f)).sort()) {
  const why = JSON.parse(readFileSync(join(out, name), "utf8"));
  const k = why.knownState;
  const own = why.results.filter((e) => e.worktreeRoot === why.worktreeRoot);
  const keys = new Set(why.results.map((e) => e.result.key));
  const errorText = JSON.stringify(why.results.map((e) => e.result.errors));
  ownRunLog ??= why.runLog;
  marker ??= /\/tmp\/squeal-\d+\/tmp\/\w+\/cez-cursor-package-\w+/.exec(errorText)?.[0] ?? null;
  console.log(`== ${name}`);
  console.log(
    `knownState: ${k?.outcome} ${k?.validity} observedAt=${k?.observedAt} origin=${JSON.stringify(k?.origin)}`,
  );
  console.log(
    `results: ${why.results.length} (${keys.size} keys); own: ${own.length}; by worktree: ${why.results.map((e) => wt(e.worktreeRoot)).join(",")}`,
  );
  console.log(`own key ${own[0]?.result.key ?? "-"}; first listed key ${why.results[0]?.result.key}`);
  console.log(`errors carry A's marker ${marker}: ${marker !== null && errorText.includes(marker)}`);
  console.log(`fingerprints: ${[...new Set(why.results.map((e) => e.result.fingerprint))].join(" | ")}`);
  console.log(`durations: ${JSON.stringify(why.durations)}`);
  console.log(
    `runLog: ${why.runLog === null ? "null" : `${why.runLog.state} run=${why.runLog.runId} worktree=${why.runLog.worktreeId}`}`,
  );
  if (why.flaky !== undefined) console.log(`flaky: ${JSON.stringify(why.flaky)}`);
}
if (ownRunLog !== null)
  console.log(`A's first run log ${ownRunLog.path} on disk at the end: ${existsSync(ownRunLog.path)}`);
