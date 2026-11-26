import { describe, expect, it } from "vitest";
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
