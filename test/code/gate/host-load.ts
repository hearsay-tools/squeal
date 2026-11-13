import type { HostLoad } from "../../../src/core/retry/load.js";

/*
 * Row 020-54 repair (review 0.1.468 B1): the gate reruns once a file that
 * failed while the host's load was at or over its CPU count (D3.4). On a
 * small CI runner the real load is often that high, so a gate test with a
 * failing file that is not about the rerun reads `QUIET` through the seam
 * (`CollectOptions.hostLoad`, `GateIo.hostLoad`). The collector's and the
 * CLI's test fixtures give it by default. The rerun tests give `AT` or
 * `OVER`; a test that simulates a loaded host gives them to the daemon's
 * own `hostLoad` with `vi.mock`, never with real load.
 */

/** Below the daemon's threshold on any host: no file reruns. */
export const QUIET: HostLoad = { oneMinute: 0, cpus: 24 };

/** At the threshold, the least load that reruns a failure (`loadAllows` wants it below the CPU count). */
export const AT: HostLoad = { oneMinute: 24, cpus: 24 };

/** Over the threshold, as a small CI runner busy with a test shard. */
export const OVER: HostLoad = { oneMinute: 48, cpus: 24 };

/** The pin the fixtures give a gate test not about the rerun. */
export const quiet = (): HostLoad => QUIET;
