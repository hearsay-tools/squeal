import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PolicyFile, TestFileRef } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { codexCommand } from "../../src/harness/codex/command.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { setKey } from "../state/helpers.js";
import { codexRecorded } from "./codex/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/** The primer's closing sentence: what Squeal leaves the agent to run (task 001-234). */
export const NOT_COVERED =
  "Squeal does not cover typecheck, build or any other test suite: run those yourself.";

export const CODEX = codexCommand(
  { PLUGIN_ROOT: "/home/someone/.codex/plugins/cache/squeal/squeal/0.1.107" },
  "/unused.mjs",
);

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

export interface RepoCase {
  readonly policy: PolicyFile;
  /** Test files the store lists beside `FILE`, or in its place with `replace`. */
  readonly files: readonly TestFileRef[];
  readonly replace?: boolean;
  /** Whether the root has `vitest.config.ts`; `true` unless said. */
  readonly vitestConfig?: boolean;
}

/** A worktree with `c`'s policy and key rows, a daemon alive and no Vitest dependency. */
export function repoFor(c: RepoCase): SquealRepo {
  const r = squealRepo();
  r.apply(r.pass());
  r.policy(c.policy);
  writeFileSync(join(r.root, "package.json"), '{"type":"module"}\n');
  if (c.vitestConfig !== false)
    writeFileSync(join(r.root, "vitest.config.ts"), "export default {};\n");
  if (c.replace === true) r.store.testFileKeys.remove(r.worktreeId, [FILE]);
  c.files.forEach((file, i) => {
    setKey(r.store, `k-extra-${i}`, { file, worktreeId: r.worktreeId });
  });
  return r;
}

/** The hook's additionalContext, and the primer: its last paragraph. */
export function primerOf(stdout: string): { context: string; primer: string } {
  const parsed = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
  const context = parsed.hookSpecificOutput.additionalContext;
  return { context, primer: context.slice(context.lastIndexOf("\n\n") + 2) };
}

/** SessionStart's stdout under `harness`, Codex naming the CLI `command`. */
export async function sessionStart(
  r: SquealRepo,
  harness: "claude-code" | "codex",
  command: string = CODEX,
): Promise<string> {
  const out =
    harness === "claude-code"
      ? await runHook("session-start", recorded("session-start", r.root), deps)
      : await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), {
          ...deps,
          command,
        });
  return out.stdout;
}

export const HARNESSES = ["claude-code", "codex"] as const;
