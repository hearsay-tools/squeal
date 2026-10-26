/*
 * The global entries (011 C3, task 011-37 section 2), under
 * `KEY_FORMAT_VERSION`: the modules whose emitted code decides what a check
 * stores or whether a stored one is accepted, each with what it decides.
 * Whole modules are re-exported as namespaces, so the bundle keeps them whole.
 * Everything else is out without a list, because no entry reaches it: the
 * CLI, status, delivery, the harnesses, `Ledger`'s queueing, `tiers.ts`'s
 * selection and the scheduling hints. The plugins' launchers are out too (row
 * 011-41, the coordinator's decision of 2026-10-20): the Node that runs is
 * in every environment hash, the CLI a launcher picks carries its own
 * `KEY_FORMAT_VERSION`, and `--disable-warning` stores nothing;
 * `test/keys/launchers.test.ts` pins that they pass Node nothing else.
 */

// The environment hash, the check key, closure helpers, observed sets, installed packages.
export * as keys from "../../../../src/core/keys/index.js";
// Accept or hold, the checks a set retires, the read of the listed formats (011-40).
export * as accept from "../../../../src/core/scheduler/accept.js";
// Closures, declared inputs, listings, gitignored paths.
export { WorktreeKeys } from "../../../../src/core/scheduler/keying.js";
// A report's rows.
export * as records from "../../../../src/core/scheduler/records.js";
// The completion barrier and the files it withholds (011-47).
export * as stability from "../../../../src/core/scheduler/stability.js";
// Per file: stored, and under which key, or discarded (011-40).
export * as storeDecision from "../../../../src/core/scheduler/store-decision.js";
// The only caller of `putMany`.
export * as storeResults from "../../../../src/core/scheduler/store-results.js";
// The states rows give.
export { classify, stateFromResult } from "../../../../src/core/state/derive.js";
// The fingerprint: it reaches `recordsForFile` as a parameter, so no import does.
export { describeFailure } from "../../../../src/core/state/fingerprint.js";
// C5's held fail.
export { heldFailure } from "../../../../src/core/state/inherited.js";
// A row's shape, and the copy of a set stored at a format read as one.
export * as results from "../../../../src/core/store/repos/results.js";
export * as schema from "../../../../src/core/store/schema.js";
