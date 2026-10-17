import { plural } from "../text.js";
import type { StatusSnapshot } from "../types/index.js";
import { countedText } from "./checks.js";

/**
 * Task 011-12 (011 C15, issue 24): status tells initial discovery, the
 * daemon still listing or keying the revision's test files, from idle work,
 * pending files nothing is running and no run holds, or files without a
 * result nothing queued, and names the command that advances each. Empty
 * when neither holds; with no daemon validating nothing runs, which the
 * daemon line says.
 */
export function workLine(s: StatusSnapshot, command: string): string[] {
  if (s.daemon.state !== "alive") return [];
  if (s.testFilesListed === false || s.runnerPartPending === true) {
    const what =
      s.testFilesListed === false
        ? "listing this worktree's test files"
        : `listing and keying the test files of revision ${s.revision}`;
    return [
      `Discovery: the daemon is still ${what} (\`${command} status --wait 60000\` waits for it)`,
    ];
  }
  const { pendingByPhase, fileLevelByPhase, testFilesWithoutChecksRunning } = s.breakdown;
  const fresh = s.testFilesWithoutChecks.pending;
  if (pendingByPhase.running > 0 || (testFilesWithoutChecksRunning ?? 0) > 0) return [];
  if ((s.runsOpen ?? 0) > 0) return [];
  const parts: string[] = [];
  if (pendingByPhase.queued > 0) {
    parts.push(countedText(pendingByPhase.queued, "queued", fileLevelByPhase?.queued));
  }
  if (fresh > 0) parts.push(`${plural(fresh, "test file")} without checks queued`);
  const unrun = s.unknownTestFiles?.total ?? 0;
  if (unrun > 0) parts.push(`${plural(unrun, "test file")} without a result, none queued`);
  if (parts.length === 0) return [];
  const all = `\`${command} run --all --wait\` runs every test file without a result and waits`;
  const slow = s.slowTier?.pending ?? 0;
  const commands =
    slow === 0
      ? all
      : `${plural(slow, "slow file")} among them: \`${command} run --slow --wait 60000\` runs those; ${all}`;
  return [`Idle: nothing is running and no run is open; ${parts.join("; ")} (${commands})`];
}
