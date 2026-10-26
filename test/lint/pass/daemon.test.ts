import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../../src/core/daemon/daemon.js";
import { readHeader } from "../../../src/core/delivery/index.js";
import {
  isLintStoreOpenFailure,
  lintStorePath,
  openLintStore,
} from "../../../src/core/lint/store/index.js";
import {
  createFixtureRepo,
  type FixtureRepo,
  SLOW,
  waitFor,
  withStore,
} from "../../daemon/helpers.js";
import { LINT_ON } from "../helpers.js";
import { FakeProvider } from "./helpers.js";

/* Spec 017 goal 1, D7: the daemon creates the lint pass only with a provider and `lint.enabled`. */

const CODE_OFF = { complexity: { enabled: false }, coverage: { enabled: false } };

const latest = (repo: FixtureRepo) =>
  withStore(repo, (store) => store.revisions.latest(repo.worktreeId)?.number ?? 0);

/** Each file's lint outcome in `repo`, as a reader opens the store; `null` while there is none. */
function outcomes(repo: FixtureRepo): Record<string, string> | null {
  const store = openLintStore(repo.commonDir, LINT_ON, { create: false });
  if (isLintStoreOpenFailure(store)) return null;
  try {
    return Object.fromEntries(
      store.states.list(repo.worktreeId).map((s) => [s.check.path, s.outcome]),
    );
  } finally {
    store.close();
  }
}

/** A daemon over a fixture repo, ready and past its baseline. */
async function daemonOver(repo: FixtureRepo, provider?: FakeProvider) {
  const daemon = await startDaemon({
    root: repo.root,
    env: repo.env,
    ...(provider === undefined ? {} : { lintProvider: () => provider }),
  });
  if ("reason" in daemon) throw new Error(daemon.message);
  onTestFinished(async () => {
    await daemon.stop("stop-requested");
  });
  await daemon.ready;
  await waitFor(
    () => withStore(repo, (store) => readHeader(store, repo.worktreeId).counts.pending === 0),
    60_000,
    "the baseline done",
  );
  return daemon;
}

/** An edit to `src/math.ts`, once the daemon stored its revision. */
async function edit(repo: FixtureRepo) {
  const before = latest(repo);
  appendFileSync(join(repo.root, "src/math.ts"), "\nexport const edited = 1;\n");
  await waitFor(() => latest(repo) > before, 30_000, "the edit's revision");
}

describe("the daemon's lint pass (spec 017 goal 1, D7)", SLOW, () => {
  it("starts no pass and creates no lint store while lint is off, and lints once it is on", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const provider = new FakeProvider();
    provider.extensions.add(".ts");
    await daemonOver(repo, provider);
    await edit(repo);
    expect(provider.opened).toBe(0);
    expect(existsSync(lintStorePath(repo.commonDir))).toBe(false);

    writeFileSync(
      join(repo.root, "squeal.config.json"),
      `${JSON.stringify({ ...CODE_OFF, lint: { enabled: true } })}\n`,
    );
    const linted = await waitFor(
      () => {
        const states = outcomes(repo);
        return states !== null && states["src/math.ts"] === "pass" ? states : null;
      },
      30_000,
      "the first lint",
    );
    expect(linted["src/strings.ts"]).toBe("pass");
    expect(provider.opened).toBe(1);
  });

  it("starts no pass without a provider, even with lint on", async () => {
    const repo = createFixtureRepo({
      files: {
        "squeal.config.json": `${JSON.stringify({ ...CODE_OFF, lint: { enabled: true } })}\n`,
      },
    });
    onTestFinished(repo.cleanup);
    await daemonOver(repo);
    await edit(repo);
    expect(existsSync(lintStorePath(repo.commonDir))).toBe(false);
  });
});
