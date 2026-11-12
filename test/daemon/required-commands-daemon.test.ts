import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS_TOPIC } from "../../src/core/daemon/required-commands.js";
import { readDaemonNotes } from "../../src/core/notes.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { runMissingConfig } from "../helpers/baseline.js";
import { daemonSuite, type FixtureRepo, SLOW, waitFor, waitReady, withStore } from "./helpers.js";

/*
 * Spec 021 D19.1 (row 021-23), against a real daemon: a command of
 * `requires.commands` missing on its `PATH` is named in status, the tests
 * still run, and a changed `squeal.config.json` that no longer needs it
 * says the commands are found.
 */

const suite = daemonSuite();
const MISSING = "tests need squeal-absent-tool; not found on PATH here";

function snapshot(repo: FixtureRepo): StatusSnapshot {
  const result = readStatus(repo.root);
  if (!result.available) throw new Error(result.message);
  return result;
}

const lines = (repo: FixtureRepo) =>
  withStore(repo, (store) => readDaemonNotes(store, repo.worktreeId))
    .filter((note) => note.topic === COMMANDS_TOPIC)
    .map((note) => note.text);

describe("requires.commands at the daemon's start (row 021-23)", SLOW, () => {
  it("names a command missing here, runs the tests, and says so once it is found", async () => {
    const config = (commands: string[]) =>
      runMissingConfig(JSON.stringify({ requires: { commands } }));
    const repo = suite.fixture({ "squeal.config.json": config(["sh", "squeal-absent-tool"]) });
    const daemon = suite.daemon(repo);
    await waitReady(repo, daemon);
    const ran = await waitFor(
      () => {
        const status = snapshot(repo);
        const pending = status.counts.pending + status.testFilesWithoutChecks.pending;
        return pending === 0 && status.counts.current > 0 ? status : null;
      },
      120_000,
      "the start's tests ran",
    );
    expect(ran.counts.current).toBeGreaterThan(0);
    expect(lines(repo)).toEqual([MISSING]);
    const text = formatStatus(readStatus(repo.root), Date.now(), "squeal", { full: true });
    expect(text).toContain(MISSING);

    writeFileSync(join(repo.root, "squeal.config.json"), config(["sh"]));
    await waitFor(
      () => lines(repo).at(-1) === "tests need sh; all found on PATH here",
      60_000,
      "the reload's line",
    );
  });
});
