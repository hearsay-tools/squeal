/*
 * The words a function's coverage reads in, for the delivery's lines and
 * `squeal code`'s. Spec 020 D12.7 (row 020-10b): where the states were
 * judged with `coverage.children`, they count the processes and threads a
 * test starts, as a lower bound.
 */

/** Row 015-65 (D9 Delivery, amended 2026-10-26): the reason an `untested` line leads with. */
export const NOT_RUN = "no test runs it in the test's own thread";

/** Spec 020 D12.7: `NOT_RUN` where the states were judged with `coverage.children`. */
export const NOT_RUN_CHILDREN =
  "no test runs it, in the test's own thread or in a process or thread the test starts";

/**
 * Row 015-80: what a line that says `NOT_RUN` also says, so it does not
 * read as "no test runs it". A test can run a file it does not load in a
 * worker thread, from a bundle (`test/lint/provider/helpers.ts`). Spec 020
 * D11.5 (row 020-07a): a file no test Squeal runs loads reads `not
 * measured` on its own line, so these words do not cover it.
 */
export const UNMEASURED = "Squeal does not measure worker threads or child processes.";

/**
 * Spec 020 D12.7 (row 020-10b, request 7f914e71): `UNMEASURED` with
 * `coverage.children`. Squeal reads a child's coverage when it exits, so
 * what it misses only lowers coverage.
 */
export const LOWER_BOUND =
  "Squeal counts what the processes and threads a test starts run as a lower bound: a process that is killed, outlives its test file or gets an environment without NODE_V8_COVERAGE is not counted.";

/** Row 015-64 (D9 as amended 2026-10-26, 2026-10-27): what a function `uncovered` reads as in `squeal code`. */
const UNTESTED = `untested: ${NOT_RUN}`;
const TESTED = "a test runs it in its own thread";

/** Spec 020 D12.7: the same with `coverage.children`. */
const UNTESTED_CHILDREN = `untested: ${NOT_RUN_CHILDREN}`;
const TESTED_CHILDREN =
  "a test runs it, in the test's own thread or in a process or thread the test starts";

export const untested = (children: true | undefined) => (children ? UNTESTED_CHILDREN : UNTESTED);
export const tested = (children: true | undefined) => (children ? TESTED_CHILDREN : TESTED);

/** Row 015-80 (D9, amended 2026-10-27): so a failing state in `squeal code` does not read as "no test runs it". */
export const MEASURED = `  Coverage counts what ran in the test's own thread. ${UNMEASURED}`;

/** Spec 020 D12.7 (request 7f914e71): `MEASURED` with `coverage.children`. */
export const MEASURED_CHILDREN = `  Coverage counts what ran in the test's own thread and in the processes and threads it started. ${LOWER_BOUND}`;
