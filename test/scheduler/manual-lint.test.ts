import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { mainStoreSource } from "../../src/core/code/pass/source.js";
import { readCommitReports } from "../../src/core/commit/store.js";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { createLintPass } from "../../src/core/lint/pass/index.js";
import { lintStatusLines } from "../../src/core/lint/surface/format.js";
import { lintStatus } from "../../src/core/lint/surface/report.js";
import { openForReading } from "../../src/core/lint/surface/source.js";
import { statCandidates } from "../../src/core/revision/reconcile.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { FakeProvider } from "../lint/pass/helpers.js";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";

/*
 * Row 019-47 (spec 019 D1 as amended 2026-11-05): a lint group at
 * `manual` keys each edit and lints nothing at the edit, at the agent's
 * pause (the lint pass here has no turn: it reads as paused) or at a
 * commit; the commit's report counts its pending check as not determined
 * and waits for nothing; status says it waits for `squeal run <group>`;
 * `squeal run <group>` lints it. One repository and store for the
 * scheduler and the daemon's lint pass, as `commit-lint.test.ts`.
 */

const FILES: CatchUpFile[] = [{ path: "test/a.test.ts", ms: 10, imports: ["src/a.ts"] }];
const X = "src/x.js";
const Y = "src/y.js";
const POLICY: Policy = {
  ...DEFAULT_POLICY,
  ...RUN_MISSING,
  lint: { ...DEFAULT_POLICY.lint, enabled: true },
  checks: [{ name: "slowlint", lint: true, at: "manual" }],
};

async function started() {
  const repo = catchUpRepo(FILES, [X, Y, "eslint.config.js"]);
  const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 4, policy: POLICY });
  await side.scheduler.start();
  const provider = new FakeProvider();
  const errors: Error[] = [];
  const commonDir = join(repo.main, ".git");
  const lint = createLintPass({
    worktreeId: side.worktreeId,
    root: side.root,
    commonDir,
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
  const status = () => {
    const source = {
      policy: () => POLICY.lint,
      open: () => openForReading(commonDir, POLICY.lint),
    };
    const read = lintStatus(source, side.worktreeId, null);
    return read === undefined ? [] : lintStatusLines(read, "squeal");
  };
  return { root: repo.main, side, provider, errors, settle, status };
}

describe("a lint group at `manual` (row 019-47)", { timeout: 60_000 }, () => {
  it("lints nothing at an edit, a pause or a commit; `squeal run <group>` lints it", async () => {
    const { root, side, provider, errors, settle, status } = await started();
    const linted = () => provider.calls.flat().filter((p) => p.endsWith(".js"));
    expect(linted(), "the first keying lints nothing").toEqual([]);

    writeFileSync(join(root, X), "bad no-undef\n");
    const hasher = createFsHasher(side.root, "sha1");
    await side.scheduler.handleBatch({
      trigger: "watch",
      paths: await statCandidates([X], hasher),
    });
    await settle();
    expect(linted(), "an edit and the pause lint nothing").toEqual([]);
    expect(status()).toEqual([
      "Lint: 0 files with findings, 2 wait for squeal run slowlint; squeal lint lists them.",
    ]);

    git(root, ["commit", "-qam", "x"]);
    await side.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await settle();
    expect(linted(), "a commit lints nothing").toEqual([]);
    const report = readCommitReports(side.store.meta, side.worktreeId)?.reports[0];
    expect(report).toMatchObject({ lint: { findings: 0, running: 0, notDetermined: 1 } });
    expect(report).not.toHaveProperty("waiting");

    expect(await side.scheduler.requestGroup("slowlint")).toMatchObject({ queued: 2 });
    await settle();
    expect(linted().sort()).toEqual([X, Y]);
    expect(status()).toEqual(["Lint: 1 file with findings; squeal lint lists them."]);
    expect(errors).toEqual([]);
  });
});
