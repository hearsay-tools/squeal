import { join } from "node:path";
import { checkRoot } from "../codex/adapter/manifest.js";
import { publishRuntime } from "../codex/adapter/store.js";

/**
 * Spec 002 D9, row 002-36: a seed CLI must retain its complete runtime
 * before starting a daemon. Publication selects no current runtime and
 * writes no session pin. A failure propagates so `start` cannot spawn from
 * a cache directory Codex may remove.
 */
export function retainSeedCli(root: string, data: string, version: string): string {
  checkRoot(root, version, process.versions.node);
  const retained = publishRuntime({ sourceRoot: root, data });
  return join(retained.root, "dist", "cli", "squeal.mjs");
}
