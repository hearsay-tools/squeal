import { existsSync } from "node:fs";
import { join } from "node:path";
import { runtimeReadiness } from "../../harness/codex/adapter/store.js";
import { codexNewest, isNewerVersion } from "./version.js";

/**
 * The runtime a new Codex session can use, read without publishing or
 * pinning (002 D8/D9, row 002-36). `codexNewest` remains adapter discovery
 * for setup and marketplace operations. A fixed plugin has hooks and a
 * seed, rather than a root CLI; its adapter version is never a runtime.
 * Legacy plugins keep their cache version as before. Kept separate from
 * version.ts: source workers load that module in Node's strip-only mode,
 * which cannot execute the adapter's TypeScript parameter properties.
 */
export function codexRuntimeVersion(plugins: string, marketplace: string): string | null {
  const installed = codexNewest(plugins, marketplace);
  if (installed === null) return null;
  const root = join(plugins, "cache", marketplace, "squeal", installed);
  const fixed =
    existsSync(join(root, "hooks", "hooks.json")) &&
    (existsSync(join(root, "seed")) || !existsSync(join(root, "dist", "cli", "squeal.mjs")));
  if (!fixed) return installed;
  const { current, seed } = runtimeReadiness({
    pluginRoot: root,
    data: join(plugins, "data", `squeal-${marketplace}`),
  });
  if (current.ready && current.version !== null) {
    return seed.ready && seed.version !== null && isNewerVersion(seed.version, current.version)
      ? seed.version
      : current.version;
  }
  return seed.ready ? seed.version : null;
}
