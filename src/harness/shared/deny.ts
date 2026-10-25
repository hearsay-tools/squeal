import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { readPolicy } from "../../core/daemon/policy.js";
import { formatDelta, readLiveHeader } from "../../core/delivery/index.js";
import {
  recordTestCommandDenied,
  testCommandDenied,
} from "../../core/delivery/test-command-denied.js";
import { resumeTurn } from "../../core/delivery/turn.js";
import { testFileId } from "../../core/keys/index.js";
import { readOmittedTestFiles } from "../../core/scheduler/omitted-test-files.js";
import { testFileKeyOf } from "../../core/state/index.js";
import type { DeltaKind, EpochMs, KnownState, Policy } from "../../core/types/index.js";
import { commandContext, configuredProjects, describing } from "../../runners/descriptions.js";
import type { HookContext, HookLocation } from "./context.js";
import { recognizeTestCommand, type TestCommand } from "./test-command.js";
import { resolveTestFiles } from "./test-command-files.js";
import { testCommandReason } from "./test-command-reason.js";
import { denialSentence } from "./text.js";

/**
 * The regressions an edit is denied for (task 001-101, lessons defect 17): a
 * check this worktree knew passing, its own result or an inherited one, that
 * fails now, with only unknown results in between. A first-seen failure, the
 * baseline's included, is delivered at the tool boundary and never denies.
 */
const DENIED_KINDS: readonly DeltaKind[] = ["pass-to-fail"];

/**
 * Before a tool call (D9 PreToolUse, task 001-93): any call puts a consumer
 * left idle in a turn before it runs, so the waiter stays silent while another
 * Stop hook's continuation works. On an edit, with `interrupt.onRegression`
 * on, an undelivered `PASS -> FAIL` denies the call once: the result is the
 * denial reason, `null` to let the call run. The peek marks only those
 * entries delivered, so recoveries and first-seen failures stay for the next
 * tool boundary and the same regression never denies twice; it also puts the
 * consumer in a turn. A `Bash` call is never denied here; spec 005 D8's
 * opt-in deny of a test command is `denyCurrentTestCommand`, run after this.
 */
export async function denyOnRegression(
  context: HookContext,
  policy: Policy,
  call: {
    readonly edit: boolean;
    readonly toolName: string;
    readonly command?: string | undefined;
  },
): Promise<string | null> {
  if (!call.edit || !policy.interrupt.onRegression) {
    resumeTurn(context.store, context.consumer);
    return null;
  }
  const delta = await context.delivery.peek(context.consumer, { kinds: DENIED_KINDS });
  if (delta === null) return null;
  return `${formatDelta(delta, call.command)}\n\n${denialSentence(call.toolName)}`;
}

/**
 * Spec 005 D8 step 1, before the store opens: the test command a `Bash`
 * call's `command` is, run from `cwd`, with `testCommand.denyWhenCurrent` on;
 * `null` for any other call, a working directory outside the worktree, or a
 * command that falls through. Which commands a runner recognizes, and from
 * which directory, is its description's (spec 016 D5).
 */
export function testCommandOf(
  location: HookLocation,
  policy: Policy,
  call: { readonly toolName: string; readonly command?: string; readonly cwd: string },
): TestCommand | null {
  if (!policy.testCommand.denyWhenCurrent || call.toolName !== "Bash") return null;
  if (call.command === undefined) return null;
  const { root } = location;
  const cwd = realPath(call.cwd);
  if (cwd === null || (cwd !== root && !cwd.startsWith(`${root}/`))) return null;
  return recognizeTestCommand(call.command, commandContext(policy, root, cwd));
}

/** `path`'s real path, as `findWorktreeRoot` resolves the root; `null` when it does not exist. */
function realPath(path: string): string | null {
  try {
    return realpathSync(resolve(path));
  } catch {
    return null;
  }
}

/**
 * Spec 005 D8 steps 2 to 4: denies `command` once per consumer when every
 * test file it runs has a current result at the live revision, with the
 * reason the results; `null` to let it run. Decided and recorded in one
 * write transaction, as 001-305's Stop wait decides, so two calls never both
 * deny. It runs when the consumer is not registered or was denied before,
 * no daemon is validating, the worktree is not listed, the runner part of
 * the revision is pending, the command does not resolve completely (the
 * listing left out a file the command runs, task 005-26), or one file is
 * pending, stale, unknown or without checks. `projects` are the projects of
 * the policy the hook read; with the policy as it reads now, they name the
 * listing's files that are not the fallback runner's (spec 003 D7).
 */
export function denyCurrentTestCommand(
  context: HookContext,
  command: TestCommand,
  projects: readonly { readonly name: string }[],
  now: EpochMs,
): string | null {
  const { store, consumer } = context;
  return store.transaction(() => {
    if (store.consumers.get(consumer) === null || testCommandDenied(store, consumer)) return null;
    const states = store.knownStates.list(consumer.worktreeId);
    const keys = store.testFileKeys.list(consumer.worktreeId);
    const header = readLiveHeader(store, consumer.worktreeId, now, states, null, keys);
    if (header.daemon?.state !== "alive" || header.testFilesListed === false) return null;
    if (header.runnerPartPending === true || header.awaitingInstall === true) return null;
    // Read live, so a policy change since the last listing counts too (review 004 wave-12 B2).
    const live = readPolicy(context.root);
    if (!describing(command).resolves(live)) return null;
    const configured = new Set([...projects, ...configuredProjects(live)].map((p) => p.name));
    const files = resolveTestFiles(
      command,
      keys.map((k) => k.testFile),
      context.root,
      configured,
      readOmittedTestFiles(store, consumer.worktreeId),
    );
    if (files === null) return null;
    const rows = new Map(keys.map((row) => [testFileId(row.testFile), row]));
    const byFile = new Map<string, KnownState[]>();
    for (const state of states) {
      const id = testFileKeyOf(state.check);
      byFile.set(id, [...(byFile.get(id) ?? []), state]);
    }
    const answered: KnownState[] = [];
    for (const file of files) {
      const row = rows.get(testFileId(file));
      const own = byFile.get(testFileId(file)) ?? [];
      if (row === undefined || row.key === null || row.pending !== null) return null;
      if (own.length === 0 || own.some((s) => s.validity !== "current")) return null;
      answered.push(...own);
    }
    recordTestCommandDenied(store, consumer, header.revision);
    return testCommandReason({
      revision: header.revision,
      files,
      states: answered,
      rootOf: (id) => store.worktrees.get(id)?.root ?? null,
    });
  });
}
