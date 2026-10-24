import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { runMissingConfig } from "../helpers/baseline.js";
import { createFixtureRepo, readNotes, SLOW, waitFor, withStore } from "./helpers.js";

/*
 * Task 001-365 (005 lessons.md proposed row 3, gh-37), through a real daemon:
 * the policy's `inputs` reach the node:test adapter, so of two files whose
 * runs load nothing beyond themselves, only the one no declaration covers is
 * named as needing inputs.
 */

const BARE = 'import { test } from "node:test";\ntest("bare", () => {});\n';
const DECLARED = "nt/test/declared.test.mjs";
const UNDECLARED = "nt/test/undeclared.test.mjs";

describe("the bare-file note under the daemon's policy inputs (task 001-365)", SLOW, () => {
  it("names the file no declaration covers and not the declared one", async () => {
    const repo = createFixtureRepo({
      files: {
        "squeal.config.json": runMissingConfig(
          JSON.stringify({
            nodeTest: [{ name: "nt", cwd: "nt", include: ["test/*.test.mjs"], argv: [], env: {} }],
            inputs: { [DECLARED]: ["nt/fixtures/**"] },
          }),
        ),
        "nt/package.json": `${JSON.stringify({ name: "nt", private: true, type: "module" })}\n`,
        "nt/fixtures/data.json": "{}\n",
        [DECLARED]: BARE,
        [UNDECLARED]: BARE,
      },
    });
    onTestFinished(repo.cleanup);
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await daemon.ready;

    const ran = () =>
      withStore(repo, (store) => {
        const rows = store.testFileKeys
          .list(repo.worktreeId)
          .filter((row) => row.testFile.project === "nt");
        return rows.length === 2 && rows.every((row) => row.key !== null && row.pending === null);
      });
    await waitFor(ran, 120_000, "both node:test files run");

    expect(readNotes(repo).filter((text) => text.includes("declare it in inputs"))).toEqual([
      `node-test project "nt": 1 test file(s) loaded nothing beyond themselves and a manifest when they ran, so what they reach through a spawned process or a file read enters no key; declare it in inputs: ${UNDECLARED}`,
    ]);
  });
});
