import { join } from "node:path";
import { readCurrent, runtimeRoot } from "../harness/codex/adapter/layout.js";
import { checkRoot } from "../harness/codex/adapter/manifest.js";
import { SEED } from "../harness/codex/adapter/store.js";
import {
  type CodexRuntimeDeps,
  codexAdapterRoot,
  codexRuntimeData,
  runUpdate,
  updateText,
} from "./codex/runtime.js";

/*
 * Row 002-34 (spec 002 D8, `wave-5-contract.md`): `squeal update`'s part for
 * the fixed Codex plugin. Codex updates the adapter through its marketplace;
 * Squeal updates the runtime, reported apart from the adapter's version. The
 * launcher the fixed plugin's users run comes from the selected runtime.
 */

export interface CodexRuntimeStep {
  /** The report line: the runtime new sessions select, and what changed. */
  readonly line: string;
  readonly version: string | null;
  /** Why the runtime was not updated; `null` when it was, or nothing newer exists. */
  readonly problem: string | null;
}

/** Updates the installed fixed plugin's runtime; `null` without a fixed plugin. */
export async function updateCodexRuntime(
  env: Readonly<Record<string, string | undefined>>,
  deps: CodexRuntimeDeps,
): Promise<CodexRuntimeStep | null> {
  const pluginRoot = codexAdapterRoot(env);
  if (pluginRoot === null) return null;
  const result = await runUpdate(pluginRoot, codexRuntimeData(env), deps);
  const name = `Codex runtime ${result.version ?? "none"}`;
  switch (result.outcome) {
    case "updated":
      return {
        line: `${name}, was ${result.previous ?? "none"}`,
        version: result.version,
        problem: null,
      };
    case "current":
      return { line: `${name}, up to date`, version: result.version, problem: null };
    default:
      return {
        line: `${name}, not updated`,
        version: result.version,
        problem: `Codex runtime: ${updateText(result)}`,
      };
  }
}

/**
 * The directory whose `bin/squeal-launcher` the fixed plugin ships to its
 * users: the selected runtime when it is complete, the seed when no runtime
 * was ever selected, and none when the selection is unreadable or incomplete,
 * which no fallback hides. `null` without a fixed plugin too.
 */
export function codexLauncherDir(env: Readonly<Record<string, string | undefined>>): string | null {
  const adapter = codexAdapterRoot(env);
  if (adapter === null) return null;
  const data = codexRuntimeData(env);
  const current = readCurrent(data);
  if (current === null) return join(adapter, SEED);
  if (current === "invalid") return null;
  const root = runtimeRoot(data, current.version);
  try {
    checkRoot(root, current.version, process.versions.node);
    return root;
  } catch {
    return null;
  }
}
