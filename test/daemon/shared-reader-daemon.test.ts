import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { publishExport } from "../../src/core/ci/publish.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { readDaemonNotes } from "../../src/core/notes.js";
import { listImports } from "../../src/core/store/imports.js";
import { CODE_OFF } from "../helpers/policy.js";
import { exportOf, git, untouched } from "../shared/remote.js";
import { until } from "./full-check-helpers.js";
import { createFixtureRepo, SLOW, withStore } from "./helpers.js";

/*
 * Spec 018 D14 (row 018-20), against a real daemon: with `shared.ref` in
 * `squeal.config.json`, the daemon fetches CI's export of its nearest main
 * commit from `origin` at start, in the background, and imports it, with no
 * note and nothing written to the clone's config, refs or `FETCH_HEAD`.
 */

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
