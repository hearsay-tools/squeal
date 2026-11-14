import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type { SlowSuiteRequest } from "../types/scheduler.js";
import type { FeedPasses } from "../types/watcher.js";
import { releaseLint } from "./commit-moment.js";
import { mayFocus } from "./focused.js";
import type { GroupTiers } from "./group-tiers.js";
import type { Ledger } from "./ledger.js";
import { answeredOf } from "./promoted-tier.js";
import type { Request, Skip } from "./request-intake-types.js";
import { groupView } from "./slow.js";
import { queueGroup } from "./slow-tier.js";

/*
 * Row 011-322: the declarations of the requests whose code the intake's
 * files hold, the files that queue theirs being another row's: `squeal run
 * <group>` (`slow-tier.ts`'s `queueGroup`, card 8's file), a named wait's
 * promotion and focused checks (`focused.ts`, `promoted-tier.ts`).
 */

/** Promote and focus write no store: only the queue's order, in memory. */
const WRITES_NO_STORE =
  "writes no store: it orders the queued files in memory, which the next commit writes";
const QUEUES_NO_FILE: Skip = {
  skip: "covers no file: it queues none, and the named wait reads its own files' results",
};

/**
 * Spec 011 C15: a named wait promotes `testFiles` for `withinMs` on this
 * daemon's clock. Only the order of queued files changes; the pump takes a
 * promoted file at the next tier boundary of a free lane, and the tier in
 * flight there may yield to it (C4 step 5 as amended 2026-10-21, row 011-51).
 */
export function promoteRequest(testFiles: readonly TestFileRef[], withinMs: number): Request<void> {
  return {
    operation: "promoting the test files of a named wait",
    start: { closed: undefined },
    installWait: { skip: WRITES_NO_STORE },
    runnerWork: { skip: "waits for no runner work: it orders files queued at their keys" },
    store: {
      skip: WRITES_NO_STORE,
      covers: QUEUES_NO_FILE,
      apply: (context, ledger) => {
        // Row 011-283 (review 0.1.384 B1): `Promotions` asks which selected file has its answer.
        ledger.queue.promote(testFiles, context.now() + withinMs, answeredOf(context, ledger));
      },
    },
    wake: { cutTiers: true },
  };
}

/**
 * Spec 011 C15, focused checks (row 011-145): a named wait asks for the
 * checks of `testFiles` that hold one of `texts`, first and alone, for
 * `withinMs` on this daemon's clock. A file that is not listed, slow or of
 * a runner that runs whole files only gets no entry. The tier in flight in
 * a file's lane may yield to it as to a promoted file (C4 step 5).
 */
export function focusRequest(
  testFiles: readonly TestFileRef[],
  texts: readonly string[],
  withinMs: number,
): Request<void> {
  return {
    operation: "focusing the checks of a named wait",
    // With no texts it asks for nothing.
    start: { closed: undefined, nothing: texts.length === 0 },
    installWait: { skip: WRITES_NO_STORE },
    runnerWork: { skip: "waits for no runner work: its tier is planned by the pump" },
    store: {
      skip: WRITES_NO_STORE,
      covers: QUEUES_NO_FILE,
      apply: (context, ledger) => {
        const until = context.now() + withinMs;
        for (const ref of testFiles) {
          if (mayFocus(context, ledger, ref)) ledger.queue.focused.add(ref, texts, until);
        }
      },
    },
    wake: { cutTiers: true },
  };
}

/**
 * Spec 019 D6: group `group`'s files run now, whatever its moment; its lane
 * still waits for the groups `after` names (D1). A lint group's pending
 * checks lint now (row 019-22): its released paths, then a pass, whose end
 * nudges the lint pass (`passes`, the change feed's; absent, none). `null`
 * for a group the policy in force does not have. `groups`: its lanes.
 * Row 011-335: taken only after a reconciliation pass that started after
 * it, as `run --all` is, so an edit made just before it is in its answer;
 * `run --slow` and a lint group's release take it too.
 */
export function groupRequest(
  group: string,
  groups: GroupTiers,
  passes: FeedPasses | undefined,
): Request<SlowSuiteRequest | null> {
  const known = (policy: Policy) => groupView(policy).groups.some((g) => g.name === group);
  /** Row 011-325: the group's files, queued, current or not, are its covered files. */
  const groupFiles = (policy: Policy, ledger: Ledger) => {
    const view = groupView(policy);
    return [...ledger.files.values()].filter((f) => view.of(f.ref).name === group);
  };
  return {
    operation: `taking a squeal run ${group} request`,
    start: {
      skip: "no closed answer: before the start the scheduler throws (`started`)",
      afterPass: true,
    },
    // Row 011-324: the answer names why nothing was queued, as the narrow run's does.
    installWait: {
      stage: (context, ledger, id, reason) =>
        known(context.policy)
          ? {
              answer: {
                revision: ledger.revision.number,
                queued: 0,
                coveredId: id,
                installWait: reason,
              },
              covered: groupFiles(context.policy, ledger),
            }
          : { answer: null, covered: [] },
    },
    runnerWork: { skip: "waits for no runner work: it queues the group's files at their keys" },
    store: {
      outside: {
        skip:
          "a lint group's release writes the lint store, never inside the store's transaction " +
          "(D3); it covers no test file and wakes no lane; while an install is awaited the " +
          "stage answers",
        release: (context, ledger) => {
          const resolved = groupView(context.policy).groups.find((g) => g.name === group);
          if (resolved?.select.kind !== "lint") return null;
          return {
            answer: { revision: ledger.revision.number, queued: releaseLint(context, group) },
          };
        },
        work: () => void passes?.pass().catch(() => {}),
      },
      stage: (context, ledger, _, id) => {
        const revision = ledger.revision.number;
        if (!known(context.policy)) return { answer: null, covered: [] };
        groups.lanes(context.policy);
        groups.get(group)?.request();
        const queued = queueGroup(context, ledger, group);
        const covered = groupFiles(context.policy, ledger);
        return { answer: { revision, queued, coveredId: id }, covered };
      },
    },
    wake: {
      skip:
        "its lane is marked requested inside the stage (`SlowTier.request`, which preempts " +
        "it), before its files are queued, as before row 011-322",
    },
  };
}
