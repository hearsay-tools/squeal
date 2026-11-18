import { registerLint } from "../lint/surface/deliver.js";
import { toldAtRegistration } from "../presence/views.js";
import { withRecorded } from "../retry/recorded.js";
import { forgetStopWait } from "../slow/stop-wait.js";
import { checkIdentity } from "../state/derive.js";
import { ignoredConfigAt } from "../status/ignored-config.js";
import { seedView, statesToSeed } from "../store/view-seed.js";
import { type AbsolutePath, type EpochMs, PAYLOAD_SCHEMA_VERSION } from "../types/common.js";
import type { Consumer, RegisterOptions, Registration, ViewEntry } from "../types/delivery.js";
import type { KnownState } from "../types/state.js";
import type { StatusHeader } from "../types/status.js";
import type { Store } from "../types/store.js";
import { withClosureChanges, withDependencies } from "./attribution.js";
import { registerCode } from "./code-deliver.js";
import { tellCommit } from "./commit-told.js";
import { recordVersion } from "./consumer-version.js";
import { oweCounts } from "./counts-owed.js";
import type { DeliveryOptions } from "./delivery.js";
import { startEdits } from "./edits.js";
import { recordHarness } from "./harness-process.js";
import { heldNow, tellHolds } from "./hold-told.js";
import { endLate } from "./late.js";
import { markLeaving } from "./leaving.js";
import {
  readLiveHeader,
  type ToldLiveness,
  tellLiveness,
  tellRevision,
  withTold,
} from "./liveness.js";
import { registrationHead, scannedDaemon, tellRegistered } from "./registered.js";
import { oweRegistration } from "./registration-owed.js";
import { tellGroupTiers, tellSlowTier } from "./slow-told.js";
import { startTurn, writeTurn } from "./turn.js";
import { recordUncoveredTold } from "./uncovered.js";
import { recordViewMark, registrationSeed } from "./view-mark.js";

/*
 * `HarnessDelivery.register` (spec 001 D6, D9): the registration's one transaction, which
 * `createDelivery` (`delivery.ts`) runs as its `register` (row 005-120 moved it here).
 */

export function registerNow(
  store: Store,
  options: DeliveryOptions,
  now: () => EpochMs,
  consumer: Consumer,
  { inTurn = false, atStart = false, startingSince, owesText }: RegisterOptions,
): Registration {
  return store.transaction(() => {
    const at = now();
    // Review wave 10b, B1: a consumer still registered keeps the revision its changes start at.
    const registered = store.consumers.get(consumer) !== null;
    // Read before the registration replaces it (review 0.1.538 B1).
    const toldView = registered ? store.views.list(consumer) : null;
    store.consumers.register(consumer, at);
    oweRegistration(store, consumer, owesText ?? null);
    // Review wave 13ba, B1: the waiting Stop entry's evidence is this registration's alone.
    forgetStopWait(store, consumer);
    // Review 001-423, B1: a mark left by an earlier SubagentStop is not this registration's.
    markLeaving(store, consumer, null);
    // Row 005-103: the view is seeded from this read, so it holds what the text is made from.
    const { states, seed } = statesToSeed(store, consumer.worktreeId);
    // Review 0.1.538 B1: a still-registered consumer's registration (a resumed session's) that
    // reports a failure its view did not hold ends its late state, as any delivered new failure
    // does: no caught-up follows it. Read before the view is replaced.
    if (toldView !== null && reportsNewFailure(toldView, states)) endLate(store, consumer);
    // Row 005-106: the states that are not `pass`, and the birth mark the rest read through.
    const { rows, mark } = registrationSeed(store, seed);
    seedView(store, consumer, rows, at);
    recordViewMark(store, consumer, mark === null ? null : { mark, at });
    // Task 001-156: a daemon this hook spawned and that has not heartbeat yet is starting.
    const told = startingSince === undefined ? null : { startingSince };
    const read = readLiveHeader(store, consumer.worktreeId, at, {
      commonDir: options.commonDir,
      states,
    });
    const live = told === null ? read : withTold(read, told, at);
    const knownFailures = withRecorded(store, consumer.worktreeId, states, live.revision);
    const header = withDependencies(
      store,
      consumer.worktreeId,
      live,
      knownFailures.map((f) => f.check),
    );
    tellAtRegistration(store, consumer, header, told, at);
    if (!registered) seedRegistered(store, consumer, header, { at, atStart, root: options.root });
    if (inTurn) startTurn(store, consumer);
    else writeTurn(store, consumer, null);
    recordHarness(store, consumer, options.harnessProcess?.() ?? null);
    recordVersion(store, consumer, options.squealVersion ?? null);
    const code = registerCode(options.code, consumer, at);
    const lint = registerLint(options.lint, consumer, at);
    return {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      consumer,
      header,
      // 011-18: a resumed session's failures name the closure paths changed since it started.
      knownFailures: withClosureChanges(store, consumer, knownFailures, header.revision),
      ...(code === undefined ? {} : { code }),
      ...(lint === undefined ? {} : { lint }),
      // Row 011-275 (gh-120): the session's first notice names the keys a runtime here leaves out.
      ...ignoredConfigAt(store.worktrees.get(consumer.worktreeId), header.daemon),
    };
  });
}

/**
 * What a registration tells `consumer` of `header` (`registerNow`): the daemon, the revision,
 * the tiers, the commit, the owed counts and the holds at `at`. Task 001-156: a daemon the hook
 * spawned and that has not heartbeat yet (`told`) is told as starting while the header reads it.
 */
function tellAtRegistration(
  store: Store,
  consumer: Consumer,
  header: StatusHeader,
  told: ToldLiveness | null,
  at: EpochMs,
): void {
  const starting = header.daemon?.state === "down" && header.daemon.startingSince !== undefined;
  const daemon = header.daemon === undefined ? null : toldAtRegistration(header.daemon);
  // Row 005-108 (review 0.1.547 B1): a slow start the registration said is told, not said again;
  // row 005-111: so is a start whose process is stopped.
  const slow =
    header.daemon?.state === "down" &&
    (header.daemon.startSlow === true || header.daemon.startStopped === true);
  tellLiveness(store, consumer, starting && !slow ? told : daemon);
  tellRevision(store, consumer, header.revision);
  tellSlowTier(store, consumer, header.slowTier);
  tellGroupTiers(store, consumer, header.groupTiers);
  tellCommit(store, consumer, header.commitLine);
  oweCounts(store, consumer, header);
  tellHolds(store, consumer, heldNow(store, consumer.worktreeId, at));
}

/**
 * The records a registration of a consumer not yet registered starts (`registerNow`): its
 * registration revision, the count of its edits, and the uncovered paths a resumed session
 * was told before it left.
 */
function seedRegistered(
  store: Store,
  consumer: Consumer,
  header: StatusHeader,
  {
    at,
    atStart,
    root,
  }: { readonly at: EpochMs; readonly atStart: boolean; readonly root: AbsolutePath | undefined },
): void {
  // Review wave 10d, S2: after tool calls the registration revision may hold their edits.
  const alive = atStart && header.daemon?.state === "alive";
  const resumed = tellRegistered(store, consumer, header.revision, {
    at,
    scanned: scannedDaemon(store, consumer.worktreeId, alive),
    head: root === undefined ? null : registrationHead(root),
  });
  // Tasks 001-223 and 001-224: edits count from here; a resumed session was told once (B2), and
  // its count goes on from where it left (row 005-100).
  startEdits(store, consumer, resumed?.editsSince ?? header.revision, resumed?.said === true);
  // Review wave 13as, B2: a path told before it left is not told again.
  if (resumed !== null) recordUncoveredTold(store, consumer, resumed.uncovered);
}
/**
 * Whether `states` hold a failing check that `view`, what the consumer was told, does not hold
 * as failing (review 0.1.538 B1). A failure the view already holds is not new, whatever its
 * diagnostic: an unchanged known failure ends no late state.
 */
function reportsNewFailure(view: readonly ViewEntry[], states: readonly KnownState[]): boolean {
  const failing = new Set(
    view.filter((v) => v.outcome === "fail").map((v) => checkIdentity(v.check)),
  );
  return states.some((s) => s.outcome === "fail" && !failing.has(checkIdentity(s.check)));
}
