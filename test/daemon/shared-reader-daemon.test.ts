import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { importCommand } from "../../src/cli/import.js";
import { publishExport } from "../../src/core/ci/publish.js";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { readDaemonNotes } from "../../src/core/notes.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { listImports } from "../../src/core/store/imports.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { exportResults } from "../../src/core/store/transfer.js";
import { encodeBundle } from "../../src/core/store/transfer-bundle.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { CODE_OFF } from "../helpers/policy.js";
import { exportOf, git, untouched } from "../shared/remote.js";
import { until } from "./full-check-helpers.js";
import { createFixtureRepo, SLOW, withStore } from "./helpers.js";

/*
 * Spec 018 D14 (row 018-20), against a real daemon: with `shared.ref` in
 * `squeal.config.json`, the daemon fetches CI's export of its nearest main
 * commit from `origin` at start, in the background, and imports it, with no
 * note and nothing written to the clone's config, refs or `FETCH_HEAD`.
 *
 * Row 018-28 (`research/shared-proof.md` Q2, Q3): at that first start, every
 * exported file is current from the import, the files whose runs read a file
 * beyond their imports (observed entries) too, and in a clone whose remote
 * was removed and added again, which has no `refs/remotes/origin/HEAD`.
 */

const INPUT = "data/input.txt";
/** The fixture's test files less `gen.test.ts`, with `reads.test.ts`. */
const FILES = 5;
const READS = `import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("reads its input", () => {
  expect(readFileSync(new URL("../${INPUT}", import.meta.url), "utf8")).toBe("input\\n");
});
`;

/** Polls `check` every 250 ms until it holds. */
async function eventually(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  for (const deadline = Date.now() + timeoutMs; !check(); await sleep(250)) {
    if (Date.now() > deadline) throw new Error(`${what}: not met in ${timeoutMs} ms`);
  }
}

async function started(root: string, env: NodeJS.ProcessEnv): Promise<RunningDaemon> {
  const daemon = await startDaemon({ root, env });
  if ("reason" in daemon) throw new Error(daemon.message);
  onTestFinished(() => daemon.stop("stop-requested").then(() => {}));
  await daemon.ready;
  return daemon;
}

/** The daemon notes of the worktree at `root`. */
function notesOf(root: string): string[] {
  const store = openStore(join(root, ".git"));
  if (isStoreOpenFailure(store)) return [];
  try {
    return readDaemonNotes(store, worktreeIdFor(root)).map((n) => n.text);
  } finally {
    store.close();
  }
}

/** The imports status reads in `root`, as `squeal status --full --json` gives them. */
function importsOf(root: string): StatusSnapshot["imports"] {
  const status = readStatus(root);
  return "imports" in status ? status.imports : undefined;
}

describe("a daemon with shared.ref (018 D14)", SLOW, () => {
  it("imports the export of its main commit at start", async () => {
    const config = { ...CODE_OFF, shared: { ref: "refs/squeal" } };
    const repo = createFixtureRepo({ files: { "squeal.config.json": JSON.stringify(config) } });
    onTestFinished(repo.cleanup);
    const remote = join(dirname(repo.root), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    git(repo.root, ["remote", "add", "origin", remote]);
    git(repo.root, ["push", "-q", "origin", "main"]);
    git(repo.root, ["fetch", "-q", "origin"]);
    git(repo.root, ["remote", "set-head", "origin", "main"]);
    const head = git(repo.root, ["rev-parse", "HEAD"]);
    // CI publishes from a checkout of its own, so the export's objects reach the clone by fetch.
    const ci = join(dirname(repo.root), "ci");
    execFileSync("git", ["clone", "-q", remote, ci]);
    const published = await publishExport({
      root: ci,
      bytes: exportOf(head),
      keep: 100,
      remote: "origin",
      prefix: "refs/squeal",
    });
    expect(published).not.toHaveProperty("refused");
    const before = untouched(repo.root);

    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(() => daemon.stop("stop-requested").then(() => {}));
    await daemon.ready;
    const imported = () => withStore(repo, (store) => listImports(store));
    await until(() => imported().length > 0, 30_000);

    expect(imported().map((i) => i.header.commit)).toEqual([head]);
    const notes = withStore(repo, (store) => readDaemonNotes(store, repo.worktreeId));
    expect(notes.filter((n) => n.text.startsWith("CI results"))).toEqual([]);
    expect(untouched(repo.root)).toBe(before);
  });
});

describe("a daemon's first start with a published export (row 018-28)", SLOW, () => {
  it("makes every exported file current, observed reads included, without origin/HEAD", async () => {
    const config = { ...CODE_OFF, shared: { ref: "refs/squeal" } };
    const ci = createFixtureRepo({
      files: {
        "squeal.config.json": JSON.stringify(config),
        [INPUT]: "input\n",
        "test/reads.test.ts": READS,
      },
    });
    onTestFinished(ci.cleanup);
    // It imports a git-ignored generated file, which a clone lacks: its closure list differs there.
    git(ci.root, ["rm", "-q", "test/gen.test.ts"]);
    git(ci.root, ["commit", "-qm", "no generated client"]);
    const remote = join(dirname(ci.root), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    git(ci.root, ["remote", "add", "origin", remote]);
    git(ci.root, ["push", "-q", "origin", "main"]);
    const commit = git(ci.root, ["rev-parse", "HEAD"]);

    // CI: the suite runs; the export of its store is published for the commit.
    const runner = await started(ci.root, ci.env);
    expect(await requestDaemon(ci.socketPath, { type: "run-all" }, 5_000)).toMatchObject({
      ok: true,
    });
    const header = {
      squealVersion: "0.0.0-test",
      keyFormat: KEY_FORMAT_VERSION,
      commit,
      dirty: false,
      createdAt: 1_762_000_000_000,
      source: { kind: "local" as const },
    };
    const exported = () => withStore(ci, (store) => exportResults(store, ci.worktreeId, header));
    await eventually(() => exported().bundle.testFiles.length === FILES, 150_000, "the CI suite");
    await runner.stop("stop-requested");
    const { bundle } = exported();
    const reads = bundle.testFiles.find((f) => f.path === "test/reads.test.ts");
    expect(reads?.observed.observed).toContain(INPUT);
    const published = await publishExport({
      root: ci.root,
      bytes: encodeBundle(bundle),
      keep: 100,
      remote: "origin",
      prefix: "refs/squeal",
    });
    expect(published).not.toHaveProperty("refused");

    // A clone whose remote was removed and added again: no origin/HEAD.
    const dev = join(dirname(ci.root), "dev");
    execFileSync("git", ["clone", "-q", remote, dev]);
    git(dev, ["remote", "remove", "origin"]);
    git(dev, ["remote", "add", "origin", remote]);
    git(dev, ["fetch", "-q", "origin"]);
    execFileSync("git", ["update-ref", "-d", "refs/remotes/origin/HEAD"], { cwd: dev });
    const root = realpathSync(dev);
    const before = untouched(root);

    await started(root, ci.env);
    await eventually(
      () => importsOf(root)?.[0]?.currentFiles === FILES,
      60_000,
      "the import",
    ).catch((error: Error) => {
      throw new Error(
        `${error.message}: ${JSON.stringify({ imports: importsOf(root), notes: notesOf(root) })}`,
      );
    });
    expect(importsOf(root)).toMatchObject([
      {
        commit,
        testFiles: FILES,
        currentFiles: FILES,
        notCurrent: { content: 0, observed: 0, closure: 0, environment: 0, noKey: 0 },
      },
    ]);
    expect(notesOf(root).filter((text) => text.startsWith("CI results"))).toEqual([]);
    expect(untouched(root)).toBe(before);

    // `squeal import` of the same export into a running daemon of a clone with no remote, which
    // fetches nothing: the same retry request re-keys at once.
    const lone = join(dirname(ci.root), "lone");
    execFileSync("git", ["clone", "-q", remote, lone]);
    git(lone, ["remote", "remove", "origin"]);
    const loneRoot = realpathSync(lone);
    await started(loneRoot, ci.env);
    expect(importsOf(loneRoot) ?? []).toEqual([]);
    const file = join(dirname(ci.root), "results.json.gz");
    writeFileSync(file, encodeBundle(bundle));
    const io = { cwd: loneRoot, env: ci.env, stdout: () => {}, stderr: () => {} };
    expect(await importCommand([file], io)).toBe(0);
    await eventually(
      () => importsOf(loneRoot)?.[0]?.currentFiles === FILES,
      60_000,
      "squeal import",
    );
  });
});
