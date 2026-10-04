/** Daemon process, socket and lifecycle, spec 001 D10, D11, D12. Task 001-30. */
export { type DaemonRequestError, requestDaemon } from "./client.js";
export {
  type DaemonOptions,
  type DaemonTimings,
  type RunningDaemon,
  startDaemon,
} from "./daemon.js";
export { daemonCliEntry, ensureDaemon, probeDaemon } from "./ensure.js";
export { acquireDaemonLock, type DaemonLock } from "./lock.js";
export { linkedWorktreeDir, runtimeDir, socketPathFor } from "./paths.js";
export { loadPolicy, POLICY_FILE, readPolicy } from "./policy.js";
export {
  createRecoveringRunner,
  type RecoveringRunner,
  type RecoveringRunnerOptions,
} from "./runner.js";
export { squealVersion } from "./version.js";
