import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { mainStoreSource } from "../../src/core/code/pass/source.js";
import {
  type CommitReport,
  commitReportsMetaKey,
  commitReportText,
  readCommitReports,
} from "../../src/core/commit/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { createLintPass } from "../../src/core/lint/pass/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { type CheckGroup, DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { FakeProvider } from "../lint/pass/helpers.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";

/*
 * Row 019-22 (spec 019 D5 steps 1 and 3): a lint group at `commit` lints
 * nothing at an edit; a new commit lints the files it changed, once; the
 * report counts them as running and updates once when they are linted. The
 * scheduler and the daemon's lint pass share one repository and store, as
 * in the daemon; the test nudges the lint pass after each batch, as the
 * daemon's `afterBatch` does.
 */

const A = "test/a.test.ts";
const FILES: CatchUpFile[] = [{ path: A, ms: 10, imports: ["src/a.ts"] }];
const X = "src/x.js";
const Y = "src/y.js";
const LINT_AT_COMMIT: CheckGroup = { name: "lint", lint: true, at: "commit" };
const POLICY: Policy = {
  ...DEFAULT_POLICY,
  ...RUN_MISSING,
  lint: { ...DEFAULT_POLICY.lint, enabled: true },
  checks: [LINT_AT_COMMIT],
};

async function started() {
  const repo = catchUpRepo(FILES, [X, Y, "eslint.config.js"]);
  const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 4, policy: POLICY });
  await side.scheduler.start();
  await side.scheduler.idle();
  const provider = new FakeProvider();
  const errors: Error[] = [];
  const lint = createLintPass({
    worktreeId: side.worktreeId,
    root: side.root,
    commonDir: join(repo.main, ".git"),
    format: "sha1",
    source: mainStoreSource(side.store, side.worktreeId, () => []),
    policy: () => POLICY,
    provider: () => provider,
    installed: () => Promise.resolve("none"),
    log: () => {},
    onError: (error) => errors.push(error),
  });
  onTestFinished(() => lint.close());
  const settle = async () => {
    await side.scheduler.idle();
    lint.nudge();
    await lint.idle();
  };
  await settle();
  return { root: repo.main, side, provider, errors, settle };
}

/** Hands the scheduler one watch batch of `paths`, as the change feed would. */
async function watch(side: CatchUpSide, ...paths: string[]): Promise<void> {
  const hasher = createFsHasher(side.root, "sha1");
  await side.scheduler.handleBatch({
    trigger: "watch",
    paths: await statCandidates(paths, hasher),
  });
}

async function pass(side: CatchUpSide): Promise<void> {
  await side.scheduler.handleBatch({ trigger: "interval", paths: [] });
}

const linted = (provider: FakeProvider) => provider.calls.flat().filter((p) => p.endsWith(".js"));

/** Each stored state of the newest commit's report, from now on. */
function writes(side: CatchUpSide): CommitReport[] {
  const seen: CommitReport[] = [];
  const { meta } = side.store;
  const set = meta.set.bind(meta);
  meta.set = (key, value) => {
    set(key, value);
    if (key !== commitReportsMetaKey(side.worktreeId)) return;
    const report = readCommitReports(meta, side.worktreeId)?.reports[0];
    if (report !== undefined && JSON.stringify(report) !== JSON.stringify(seen.at(-1))) {
      seen.push(report);
    }
  };
  return seen;
}

describe("a lint group at commit (019-22)", { timeout: 60_000 }, () => {
  it("lints what a new commit changed, once, and the report updates once after", async () => {
    const { root, side, provider, errors, settle } = await started();
    expect(linted(provider), "never before a commit").toEqual([]);
    writeFileSync(join(root, X), "bad no-undef\n");
    await watch(side, X);
    await settle();
    expect(linted(provider), "an edit lints nothing").toEqual([]);

    git(root, ["commit", "-qam", "x"]);
    const commit = git(root, ["rev-parse", "HEAD"]).trim();
    const stored = writes(side);
    await pass(side);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ commit, lint: { findings: 0, running: 1 } });
    await settle();
    expect(linted(provider), "the commit changed x only").toEqual([X]);

    await pass(side);
    await settle();
    await pass(side);
    expect(linted(provider), "once per commit").toEqual([X]);
    expect(stored).toHaveLength(2);
    expect(stored[1]).toMatchObject({ commit, updated: true, lint: { findings: 1, running: 0 } });
    expect(stored[1]).not.toHaveProperty("waiting");
    expect(commitReportText(stored[1] as CommitReport)).toContain("lint 1 finding");

    // An edit, then a commit that does not hold it: nothing lints.
    writeFileSync(join(root, Y), "bad semi\n");
    await watch(side, Y);
    await settle();
    git(root, ["commit", "-qm", "empty", "--allow-empty"]);
    await pass(side);
    await settle();
    expect(linted(provider)).toEqual([X]);
    expect(errors).toEqual([]);
  });

  it("an edit before the lint run leaves the file to the next commit; the report updates once", async () => {
    const { root, side, provider, errors, settle } = await started();
    writeFileSync(join(root, X), "bad no-undef\n");
    await watch(side, X);
    await settle();
    git(root, ["commit", "-qam", "x"]);
    const stored = writes(side);
    await pass(side);
    expect(stored[0]).toMatchObject({ lint: { running: 1 } });
    // The edit's batch comes before the lint pass runs: x waits at a blob no commit holds.
    writeFileSync(join(root, X), "bad semi\n");
    await watch(side, X);
    await settle();
    await pass(side);
    await settle();
    await pass(side);
    expect(linted(provider), "nothing lints before the next commit").toEqual([]);
    expect(stored.map((r) => ("lint" in r ? r.lint : r))).toEqual([
      { findings: 0, notDetermined: 1, running: 1 },
      { findings: 0, notDetermined: 2, running: 0 },
    ]);
    expect(stored[1]).toMatchObject({ updated: true });
    expect(errors).toEqual([]);
  });

  it("`squeal run lint` lints the group's waiting checks now, whatever its moment", async () => {
    const { side, provider, errors, settle } = await started();
    expect(linted(provider)).toEqual([]);
    expect(await side.scheduler.requestGroup("lint")).toMatchObject({ queued: 2 });
    await settle();
    expect(linted(provider).sort()).toEqual([X, Y]);
    expect(await side.scheduler.requestGroup("lint")).toMatchObject({ queued: 0 });
    expect(errors).toEqual([]);
  });
});
