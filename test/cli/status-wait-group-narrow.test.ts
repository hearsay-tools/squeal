import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import type { RevisionNumber } from "../../src/core/types/index.js";
import { CODEX } from "../harness/primer-helpers.js";
import { A, B, C, finish, later, NOW, repoWith, SLOW_FILE } from "./status-wait-fixture.js";

/*
 * Row 019-52 (019 D6 "Narrow run", amended 2026-11-06): a named `status
 * --wait <path>...` that leaves a group's files names the narrow run with
 * the wait's own paths, as given, up to 3, else `<path>...`; the whole-group
 * command stays named once, for the rest of the group. A path that selects
 * nothing is left out, since the narrow run would give no verdict for it.
 */

const synced = () => ({
  state: "synced" as const,
  revision: 4 as RevisionNumber,
  incarnation: null,
});

/** A named wait over `paths`; `A`, when named, passes after 100 ms; `B` and `C` are current; `group` owns `tests`, queued. */
async function named(
  paths: readonly string[],
  group: Record<string, unknown>,
  { command, tests = [SLOW_FILE] }: { command?: string; tests?: readonly string[] } = {},
) {
  const fast = paths.includes(A);
  const { repo, store } = repoWith(fast ? [A, ...tests] : tests, [B, C]);
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ checks: [{ name: "e2e", runner: "vitest", tests, ...group }] }),
  );
  if (fast) later(100, () => finish(store, repo.mainId, A));
  const wait = await waitForNamed(repo.main, paths, {
    timeoutMs: 3_000,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync: () => ({ current: synced, stop: () => {} }),
  });
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  return namedText(wait, NOW, command).trimEnd().split("\n").at(-1) ?? "";
}

const STOP = { at: "stop" };
const MANUAL = { at: "manual" };

describe("a named wait that leaves a group's files names the narrow run (019-52)", () => {
  it("a stop group, one path: the narrow run with that path; the group's run named once", async () => {
    const last = await named([SLOW_FILE], STOP);
    expect(last).toContain(
      `1 e2e test file waits for a pause or \`squeal run e2e\`, which this wait does not hold for: ${SLOW_FILE}; this repository requires it before you finish: \`squeal run e2e ${SLOW_FILE} --wait 60000\` runs and waits for it`,
    );
    expect(last).not.toContain("`squeal run e2e --wait");
    expect(last.split("`squeal run e2e`").length).toBe(2);
  });

  it("a manual group, one path: the narrow run runs it now", async () => {
    const last = await named([SLOW_FILE], MANUAL);
    expect(last).toContain(
      `1 e2e test file waits for \`squeal run e2e\`, which this wait does not hold for: ${SLOW_FILE}; this repository does not require it before you finish; \`squeal run e2e ${SLOW_FILE} --wait 60000\` runs it now and waits for its result`,
    );
  });

  it.each([
    ["stop", STOP, "this repository requires it before you finish: "],
    ["manual", MANUAL, "this repository does not require it before you finish; "],
  ])("a %s group, four paths: <path>... in place of the paths", async (_, group, policy) => {
    const last = await named([A, B, C, SLOW_FILE], group);
    expect(last).toContain(`${policy}\`squeal run e2e <path>... --wait 60000\``);
    expect(last).not.toContain(`e2e ${A}`);
  });

  it("names the CLI by its path in Codex, in both commands", async () => {
    const one = await named([SLOW_FILE], STOP, { command: CODEX });
    expect(one).toContain(
      `waits for a pause or \`${CODEX} run e2e\`, which this wait does not hold for: ${SLOW_FILE}; this repository requires it before you finish: \`${CODEX} run e2e ${SLOW_FILE} --wait 60000\` runs and waits for it`,
    );
    const four = await named([A, B, C, SLOW_FILE], MANUAL, { command: CODEX });
    expect(four).toContain(
      `waits for \`${CODEX} run e2e\`, which this wait does not hold for: ${SLOW_FILE}; this repository does not require it before you finish; \`${CODEX} run e2e <path>... --wait 60000\` runs it now`,
    );
    expect(four).not.toContain("`squeal run");
  });

  it("names three paths as given, without one that selects nothing, shell-quoted", async () => {
    const spaced = "test/slow two.test.ts";
    const last = await named([A, "src/missing.ts", SLOW_FILE, spaced], STOP, {
      tests: [SLOW_FILE, spaced],
    });
    expect(last).toContain(
      `\`squeal run e2e ${A} ${SLOW_FILE} 'test/slow two.test.ts' --wait 60000\` runs and waits for them`,
    );
  });
});
