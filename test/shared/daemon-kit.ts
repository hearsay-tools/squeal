import { expect } from "vitest";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { ImportsSeen } from "../../src/core/shared/imports-seen.js";
import { exportResults } from "../../src/core/store/transfer.js";
import { encodeBundle, type ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { claimRepo, type FakeRunner, type Side, side } from "../scheduler/claims-fixture.js";
import { publish, readerOf } from "./reader-kit.js";
import type { Scratch } from "./remote.js";
import { git } from "./remote.js";

/*
 * Rows 018-28 and 018-44: what the tests of a reader beside a running daemon
 * share. A CI run whose files each read `INPUT` beyond their closure, its
 * export published, and daemons over a clone of that remote, each wired to
 * its reader as `daemon.ts` wires them.
 */

export const COUNT = 3;
export const INPUT = "data/input.txt";
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };

/** Each completed file's run read `INPUT` beyond its closure, as a test that opens a fixture does. */
function readsInput(s: Side): void {
  const run = s.runner.run.bind(s.runner);
  s.runner.run = async (files) => {
    const report = await run(files);
    const observed = report.completedFiles.map((testFile) => ({
      testFile,
      paths: [INPUT],
      directories: [],
    }));
    return { ...report, observed };
  };
}

/** The current passing tests of `s` whose origin is an import. */
export function importedPasses(s: Side): number {
  return s.store.knownStates
    .list(s.worktreeId)
    .filter((k) => k.check.kind === "test" && k.validity === "current" && k.outcome === "pass")
    .filter((k) => k.origin?.kind === "imported").length;
}

/** What the fake runner gives as its environments. */
type Environment = FakeRunner["environment"];

/** The one project's environment, as the fake runner gives it, a Vitest one, with `resolvedConfig`. */
export function environmentWith(resolvedConfig: string): Environment {
  return async () => [
    {
      project: "",
      runnerName: "vitest",
      runnerVersion: "1",
      adapterVersion: "1",
      resolvedConfig,
      files: [],
    },
  ];
}

/**
 * A CI run of `COUNT` files that each read `INPUT`, in `environment` when
 * given, its export, through `edit` when given, published on `s` for its
 * commit: the commit.
 */
export async function publishedRun(
  s: Scratch,
  environment?: Environment,
  edit: (bundle: ResultsBundle) => ResultsBundle = (bundle) => bundle,
): Promise<string> {
  const { main: ci } = claimRepo(COUNT, { [INPUT]: "input\n" });
  const a = side(ci, { count: COUNT });
  if (environment !== undefined) a.runner.environment = environment;
  readsInput(a);
  await a.scheduler.start();
  await a.scheduler.requestFullSuite();
  await a.scheduler.idle();
  const commit = git(ci, ["rev-parse", "HEAD"]);
  const { bundle } = exportResults(a.store, a.worktreeId, {
    squealVersion: "0.0.0-test",
    keyFormat: KEY_FORMAT_VERSION,
    commit,
    dirty: false,
    createdAt: 1_762_000_000_000,
    source: { kind: "local" },
  });
  expect(bundle.testFiles.map((f) => f.observed.observed)).toEqual(
    Array.from({ length: COUNT }, () => [INPUT]),
  );
  git(ci, ["remote", "add", "origin", s.remote]);
  git(ci, ["push", "-q", "origin", "main"]);
  await publish(ci, commit, encodeBundle(edit(bundle)));
  return commit;
}

/**
 * A lookup-only daemon of the worktree at `root`, in `environment` when
 * given, started and idle, and a reader of it, made anew at each call as a
 * restart makes one. `retry` is the daemon's retry request, which the
 * reader's callback makes.
 */
export async function daemonOf(root: string, environment?: Environment) {
  const d = side(root, { count: COUNT, policy: LOOKUP_ONLY });
  if (environment !== undefined) d.runner.environment = environment;
  const seen = new ImportsSeen(d.store);
  const retry = async () => {
    await seen.take((projects, imports) => d.scheduler.requestImports(projects, imports));
    await d.scheduler.requestRetries();
  };
  await d.scheduler.start();
  await d.scheduler.idle();
  const reader = () => readerOf(root, { store: d.store, imported: () => void retry() });
  return { d, retry, reader };
}
