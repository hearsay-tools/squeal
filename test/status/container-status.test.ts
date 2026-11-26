import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { appendNote } from "../../src/core/notes.js";
import {
  containerLines,
  containerSummaries,
  containerSummaryText,
  readContainerSummary,
  writeContainerSummary,
} from "../../src/core/status/container-status.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { MAX_PERSISTED_NOTES } from "../../src/core/types/scheduler.js";
import { createFixtureRepo, SLOW, waitFor, withStore } from "../daemon/helpers.js";
import { CODE_OFF } from "../helpers/policy.js";
import { appendRevisions, fakeRepo, seedStore } from "./helpers.js";

/*
 * Spec 027 D7.3 (row 027-06): plain `squeal status` prints each container
 * target's state and key mode as `Containers:`, from a row of its own that
 * no note evicts, and nothing once the row is removed.
 */

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const entry = (target: string, project: string, state: string, keyMode = "build-content") => ({
  target,
  project,
  runner: "pytest",
  state,
  keyMode,
});

describe("the container summary line (D7.3)", () => {
  it("names each target once, sorted, with its states and key mode", () => {
    expect(
      containerSummaryText([
        entry("workers", "workers", "unconsented"),
        entry("backend", "api", "ready"),
        entry("backend", "admin", "node-too-old"),
        entry("strict", "s", "ready", "image-id"),
      ]),
    ).toBe(
      "container backend (node-too-old/ready, build-content); container strict (ready, image-id); container workers (unconsented, build-content)",
    );
    expect(containerSummaryText([])).toBe("");
    expect(containerLines({})).toEqual([]);
    expect(containerLines({ containers: "container backend (ready, build-content)" })).toEqual([
      "Containers: container backend (ready, build-content)",
    ]);
  });

  it("tells the daemon a new line only when a project's state changed it", () => {
    const live = containerSummaries();
    expect(live.set(entry("backend", "api", "unconsented"))).toBe(
      "container backend (unconsented, build-content)",
    );
    expect(live.set(entry("backend", "api", "unconsented"))).toBeNull();
    expect(live.set(entry("backend", "api", "ready"))).toBe(
      "container backend (ready, build-content)",
    );
  });

  it("prints Containers: after many other notes, and none once cleared", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const wt = repo.mainId;
    store.worktrees.upsert({
      id: wt,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
    appendRevisions(store, wt, 1, { head: null, dirty: true });
    const plain = () => {
      const status = readStatus(repo.main);
      if (!status.available) throw new Error(status.message);
      return { lines: formatStatus(status, NOW).split("\n"), containers: status.containers };
    };
    const line = "container backend (ready, build-content)";
    writeContainerSummary(store, wt, line);
    for (let i = 0; i < MAX_PERSISTED_NOTES + 5; i++) {
      appendNote(store, wt, { at: 0, revision: 1, text: `churn ${i}` });
    }
    expect(plain().lines).toContain(`Containers: ${line}`);
    expect(plain().containers).toBe(line);

    writeContainerSummary(store, wt, "");
    expect(readContainerSummary(store, wt)).toBeUndefined();
    expect(plain().lines.filter((l) => l.startsWith("Containers:"))).toEqual([]);
  });
});

/*
 * Review 0.1.644 N1: a policy reload drops each container project the new
 * policy no longer configures, or configures in another target, from the
 * line; the last one removed clears the row.
 */
describe("the container summary at a policy reload (review 0.1.644 N1)", () => {
  it("drops retired projects and stale targets, and is empty once none is left", () => {
    const live = containerSummaries();
    live.set(entry("a", "api", "ready"));
    live.set(entry("w", "workers", "unconsented"));
    expect(live.reconcile([{ runner: "pytest", project: "api", target: "a" }])).toBe(
      "container a (ready, build-content)",
    );
    // Nothing changed: no new line.
    expect(live.reconcile([{ runner: "pytest", project: "api", target: "a" }])).toBeNull();
    // The project moved to target `b`: `a` goes before `b` reports a state.
    expect(live.reconcile([{ runner: "pytest", project: "api", target: "b" }])).toBe("");
    expect(live.set(entry("b", "api", "ready"))).toBe("container b (ready, build-content)");
    // Another runner's project of the same name is another project.
    expect(live.reconcile([{ runner: "jest", project: "api", target: "b" }])).toBe("");
    expect(live.reconcile([])).toBeNull();
  });

  it("in a live daemon: a moved target leaves the line, and removing the last project clears it", {
    ...SLOW,
  }, async () => {
    const config = (pytest: object[]) =>
      `${JSON.stringify({
        ...CODE_OFF,
        containers: { a: { image: "squeal-test/a" }, b: { image: "squeal-test/b" } },
        pytest,
      })}\n`;
    const repo = createFixtureRepo({
      files: {
        "squeal.config.json": config([
          { name: "py", cwd: "py", include: ["tests/test_*.py"], container: "a" },
        ]),
        "py/tests/test_a.py": "def test_a():\n    assert True\n",
      },
    });
    onTestFinished(repo.cleanup);
    // A CLI inside a complete bundle gives the daemon its container route. No consent
    // exists in the test's config directory, so no Docker command runs.
    const cli = join(import.meta.dirname, "..", "..", "plugins", "claude-code", "dist", "cli");
    const daemon = await startDaemon({
      root: repo.root,
      env: repo.env,
      log: () => {},
      timings: { checkMs: 50 },
      runnerHost: { execPath: process.execPath, execArgv: [], cli: join(cli, "squeal.mjs") },
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await daemon.ready;
    const summary = () => withStore(repo, (store) => readContainerSummary(store, repo.worktreeId));
    await waitFor(() => summary() === "container a (unconsented, build-content)", 60_000, "a");

    writeFileSync(
      join(repo.root, "squeal.config.json"),
      config([{ name: "py", cwd: "py", include: ["tests/test_*.py"], container: "b" }]),
    );
    await waitFor(() => summary() === "container b (unconsented, build-content)", 60_000, "b");

    writeFileSync(
      join(repo.root, "squeal.config.json"),
      config([{ name: "py", cwd: "py", include: ["tests/test_*.py"] }]),
    );
    await waitFor(() => summary() === undefined, 60_000, "cleared");
    expect(summary()).toBeUndefined();
  });
});
