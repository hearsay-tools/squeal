import { type ProcStat, pidNamespace, readProcStat } from "../../core/delivery/index.js";
import type { HarnessProcess } from "../../core/types/index.js";

/** Shells and launchers a hook's ancestor chain passes before the harness. */
const SKIPPED: ReadonlySet<string> = new Set([
  "sh",
  "dash",
  "bash",
  "zsh",
  "ksh",
  "mksh",
  "fish",
  "env",
  "nohup",
  "timeout",
]);

/** A shell form that does not exec adds one `sh`; a Codex `$SHELL -lc` one more at most. */
const MAX_HOPS = 4;

export interface HarnessLookup {
  /** Default `process.ppid`. */
  readonly ppid?: number;
  readonly read?: (pid: number) => ProcStat | null;
  readonly namespace?: () => string | null;
}

/**
 * The harness process a hook runs under (`research/harness-process-liveness.md`):
 * the nearest ancestor that is not a shell or launcher, at most four hops up
 * from the hook's parent. Under Claude Code that is the process `CLAUDE_PID`
 * names in every case the research recorded, so the walk alone serves both
 * harnesses and no hook bundle names a harness's variable (spec 002 D4).
 * `null`, so the consumer keeps the 12 hour expiry, without `/proc` (macOS),
 * when a read fails, or when the walk reaches pid 1, `systemd` (the harness
 * died first) or its hop limit.
 */
export function findHarnessProcess(lookup: HarnessLookup = {}): HarnessProcess | null {
  const read = lookup.read ?? readProcStat;
  const namespace = (lookup.namespace ?? pidNamespace)();
  if (namespace === null) return null;
  let pid = lookup.ppid ?? process.ppid;
  try {
    for (let hop = 0; hop < MAX_HOPS && pid > 1; hop++) {
      const stat = read(pid);
      if (stat === null || stat.state === "Z" || stat.comm === "systemd") return null;
      if (!SKIPPED.has(stat.comm)) {
        return { pid, startTime: stat.startTime, pidNamespace: namespace };
      }
      pid = stat.ppid;
    }
  } catch {
    return null;
  }
  return null;
}
