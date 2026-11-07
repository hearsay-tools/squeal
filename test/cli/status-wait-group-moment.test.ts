import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { namedCode, waitForNamed } from "../../src/cli/status-wait-paths.js";
import type { RevisionNumber } from "../../src/core/types/common.js";
import { CODEX } from "../harness/primer-helpers.js";
import { A, finish, NOW, repoWith, SLOW_FILE } from "./status-wait-fixture.js";
import { later } from "./wait-clock.js";

/*
 * Row 019-25 (spec 019 D1, D6; the coordinator, 2026-11-04): a named
 * `status --wait` holds a configured group's file only while the group's
 * moment lets it run inside the agent's turn. A queued file of a group at
 * `pause`, `stop` or `commit` is left out of what the wait holds for and
 * named, under every `slow.trigger`, as a slow file under `"idle"` is
 * (task 004-78). A group at `edit` runs after each edit: the wait holds
 * for it. Without `checks` the rule is 004-78's (`status-wait-paths-slow`).
 */

const synced = () => ({
  state: "synced" as const,
  revision: 4 as RevisionNumber,
  incarnation: null,
});

/** `A` pending then passing after 100 ms; the group's file queued; `finishGroup` ends it at 300 ms. */
async function named(
  group: Record<string, unknown>,
  trigger = "continuous",
  { finishGroup = false, timeoutMs = 3_000, paths = [A, SLOW_FILE] } = {},
) {
  const { repo, store } = repoWith(paths.includes(A) ? [A, SLOW_FILE] : [SLOW_FILE]);
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({
      slow: { trigger },
      checks: [{ name: "e2e", runner: "vitest", tests: [SLOW_FILE], ...group }],
    }),
  );
  if (paths.includes(A)) later(100, () => finish(store, repo.mainId, A));
  if (finishGroup) later(300, () => finish(store, repo.mainId, SLOW_FILE));
  const wait = await waitForNamed(repo.main, paths, {
    timeoutMs,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync: () => ({ current: synced, stop: () => {} }),
  });
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  return { wait, last: namedText(wait, NOW).trimEnd().split("\n").at(-1) ?? "" };
}

describe("a named wait holds a group's file only for what its moment allows (019-25)", () => {
  it.each([
    ["stop", "a pause"],
    ["pause", "a pause"],
    ["commit", "a commit"],
  ])("leaves out a file of a group at %s under slow.trigger continuous", async (at, waitsFor) => {
    const { wait, last } = await named({ at });
    expect(wait.outcome).toBe("settled");
    expect(wait.waitedMs).toBeLessThan(2_000);
    expect(wait.leftForPause?.map((f) => f.path)).toEqual([SLOW_FILE]);
    expect(wait.verdict).toMatchObject({ testFiles: 1, byClass: { current: 1, pending: 0 } });
    expect(namedCode(wait)).toBe(0);
    expect(last).toContain(`; 1 e2e test file waits for ${waitsFor} or \`squeal run e2e\`, `);
  });

  // Row 019-47 (the coordinator, 2026-11-05, option A): as every group outside the turn.
  it("leaves out a file of a group at manual and names its run alone", async () => {
    const { wait, last } = await named({ at: "manual" });
    expect(wait.outcome).toBe("settled");
    expect(wait.leftForPause?.map((f) => f.path)).toEqual([SLOW_FILE]);
    expect(wait.verdict).toMatchObject({ testFiles: 1, byClass: { current: 1, pending: 0 } });
    expect(last).toContain(
      `; 1 e2e test file waits for \`squeal run e2e\`, which this wait does not hold for: ${SLOW_FILE}; this repository does not require it before you finish; \`squeal run e2e ${SLOW_FILE} --wait 60000\` runs it now and waits for its result`,
    );
    const { wait: alone } = await named({ at: "manual" }, "continuous", { paths: [SLOW_FILE] });
    expect(alone.outcome).toBe("slow");
    expect(namedText(alone, NOW).split("\n")).toContain(
      `  1 in the e2e group, waits for \`squeal run e2e\`: ${SLOW_FILE}`,
    );
  });

  it("holds for a file of a group at edit, under slow.trigger idle too", async () => {
    const { wait } = await named({ at: "edit" }, "idle", { finishGroup: true });
    expect(wait.outcome).toBe("settled");
    expect(wait.leftForPause).toEqual([]);
    expect(wait.verdict).toMatchObject({ testFiles: 2, byClass: { current: 2, pending: 0 } });
    expect(wait.waitedMs).toBeGreaterThanOrEqual(250);
  });
});

/*
 * Row 019-25 (3): what holds a configured group's queued file is named by
 * its group, its moment and `squeal run <group>`, never as a slow file and
 * `run --slow`. Without `checks` the reason is as before
 * (`status-wait-paths-slow`, `named-wait-reasons`).
 */
describe("a group's queued file is named by its group in a named wait (019-25)", () => {
  it.each([
    ["stop", "when the agent pauses"],
    ["commit", "at each commit"],
  ])("a group at %s: the class line names the group and its command", async (at, when) => {
    const { wait } = await named({ at }, "continuous", { paths: [SLOW_FILE] });
    expect(wait.outcome).toBe("slow");
    const line = `  1 in the e2e group, run ${when} or on \`squeal run e2e\`: ${SLOW_FILE}`;
    expect(namedText(wait, NOW).split("\n")).toContain(line);
    expect(namedText(wait, NOW, CODEX).split("\n")).toContain(
      line.replace("`squeal run", `\`${CODEX} run`),
    );
    expect(namedText(wait, NOW)).not.toContain("run --slow");
  });

  it("a group at edit: the timeout's reason names the group and its command", async () => {
    const { wait, last } = await named({ at: "edit" }, "continuous", { timeoutMs: 500 });
    expect(wait.outcome).toBe("timeout");
    expect(namedText(wait, NOW).split("\n")).toContain(
      `  1 in the e2e group, run after each edit or on \`squeal run e2e\`: ${SLOW_FILE}`,
    );
    expect(last).toContain(
      "1 test file still pending at revision 4: 1 in the e2e group: `squeal run e2e`",
    );
    expect(last).not.toContain("run --slow");
    expect(last).not.toContain("1 slow");
  });
});
