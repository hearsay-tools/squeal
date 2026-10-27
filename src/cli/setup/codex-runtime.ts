import { selectRuntime } from "../../harness/codex/adapter/store.js";
import {
  type CodexRuntimeDeps,
  codexAdapterRoot,
  codexRuntimeData,
  codexRuntimeStatus,
  ensureRuntime,
  readyLine,
  runUpdate,
  updateText,
} from "../codex/runtime.js";
import type { CliIo } from "../main.js";

/*
 * Row 002-34 (spec 002 D7, `wave-5-contract.md`): setup checks the fixed
 * Codex plugin's runtime with plugin presence, hook trust and repository
 * configuration. A plugin installed and trusted is not ready by itself: a
 * new session must find a complete runtime, the current one or the seed.
 * Applying setup for Codex prepares it with `codex-runtime`'s operations.
 */

/** The fixed plugin's runtime; `no-adapter` without one, as with a plugin from before it. */
export type CodexRuntimeFact =
  | { readonly state: "no-adapter" }
  | {
      readonly state: "ready" | "not-ready";
      readonly adapter: { readonly root: string; readonly version: string | null };
      /** The runtime a new session selects; `null` when none can be. */
      readonly runtime: string | null;
      /** What is wrong with the current runtime and the seed, when not ready. */
      readonly problems: readonly string[];
      /** The last update check's result and failure code, `null` before the first. */
      readonly lastCheck: { readonly outcome: string; readonly failure: string | null } | null;
      /** What prepares or repairs it without setup. */
      readonly command: string;
    };

type Env = Readonly<Record<string, string | undefined>>;

export function readCodexRuntime(env: Env): CodexRuntimeFact {
  const root = codexAdapterRoot(env);
  if (root === null) return { state: "no-adapter" };
  const s = codexRuntimeStatus(root, codexRuntimeData(env));
  return {
    state: s.ready ? "ready" : "not-ready",
    adapter: s.adapter,
    runtime: s.selected,
    problems: s.ready
      ? []
      : [`current runtime: ${s.current.problem ?? "ready"}`, `seed: ${s.seed.problem ?? "ready"}`],
    lastCheck:
      s.update === null
        ? null
        : { outcome: s.update.outcome, failure: s.update.failure?.code ?? null },
    command: `squeal codex-runtime ${s.ready ? "ensure" : "update"} --plugin-root ${root}`,
  };
}

/** The `--check` line for a runtime that is not ready, else none. */
export function codexRuntimeOutdated(fact: CodexRuntimeFact | undefined): string[] {
  if (fact === undefined || fact.state !== "not-ready") return [];
  return [
    `Codex runtime: not ready (${fact.problems.join("; ")}); squeal setup prepares it, or ${fact.command}`,
  ];
}

/** The plan's line, or none without a fixed plugin. */
export function codexRuntimeLine(fact: CodexRuntimeFact | undefined): string[] {
  if (fact === undefined || fact.state === "no-adapter") return [];
  const adapter = `adapter ${fact.adapter.version ?? "unknown"}`;
  const check =
    fact.lastCheck?.failure == null ? "" : `; last update check failed (${fact.lastCheck.failure})`;
  return [
    fact.state === "ready"
      ? `Codex runtime: ${fact.runtime} ready (${adapter})${check}`
      : `Codex runtime: not ready (${adapter}): ${fact.problems.join("; ")}; squeal setup prepares it`,
  ];
}

/**
 * Applying setup for Codex: selects a complete local runtime with no network
 * (`ensure`); only when none is complete, runs one bounded update and
 * selects again. Exit 0 when ready.
 */
export async function prepareCodexRuntime(
  fact: CodexRuntimeFact | undefined,
  io: CliIo,
  deps: CodexRuntimeDeps = {},
): Promise<number> {
  if (fact === undefined || fact.state === "no-adapter") return 0;
  const root = fact.adapter.root;
  const data = codexRuntimeData(io.env ?? process.env);
  try {
    io.stdout(readyLine(selectRuntime({ pluginRoot: root, data, sessionId: null })));
    return 0;
  } catch (error) {
    io.stdout(
      `squeal setup: no complete Codex runtime here (${(error as Error).message}); downloading the latest release\n`,
    );
    const result = await runUpdate(root, data, deps);
    if (result.outcome === "failed" || result.outcome === "busy") {
      io.stderr(`squeal setup: ${updateText(result)}\n`);
      return 1;
    }
  }
  return ensureRuntime(root, data, io);
}
