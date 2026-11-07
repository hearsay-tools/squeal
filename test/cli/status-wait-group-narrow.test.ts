import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import type { AbsolutePath, RevisionNumber } from "../../src/core/types/common.js";
import { CODEX } from "../harness/primer-helpers.js";
import { A, B, C, finish, NOW, repoWith } from "./status-wait-fixture.js";
import { later } from "./wait-clock.js";

/*
 * Row 019-52 (019 D6 "Narrow run", amended after review 0.1.412 B1): a
 * named `status --wait <path>...` that leaves up to 10 of a group's files
 * names the narrow run with the left test files' own paths, which select
 * themselves, so it runs exactly the files the clause names; with more, the
 * whole group's run, as before. The wait's own paths are never named: a
 * source path selects fewer files (`status-wait-group-readers.test.ts`).
 */

const synced = () => ({
  state: "synced" as const,
  revision: 4 as RevisionNumber,
  incarnation: null,
});

/** `count` e2e test files, `test/e2e/fNN.test.ts`. */
const e2e = (count: number) =>
  Array.from({ length: count }, (_, i) => `test/e2e/f${String(i).padStart(2, "0")}.test.ts`);
const ONE = "test/e2e/f00.test.ts";

interface Named {
  readonly command?: string;
  /** The group's test files, queued; default the named paths but `A`. */
  readonly tests?: readonly string[];
  /** The wait's directory under the worktree; default its top level. */
  readonly dir?: string;
}

/** A named wait over `paths`; `A`, when named, passes after 100 ms; `B` and `C` are current; `group` owns `tests`. */
async function named(
  paths: readonly string[],
  group: Record<string, unknown>,
  { command, tests = paths.filter((p) => p !== A), dir }: Named = {},
) {
  const fast = paths.includes(A);
  const { repo, store } = repoWith(fast ? [A, ...tests] : tests, [B, C]);
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ checks: [{ name: "e2e", runner: "vitest", tests, ...group }] }),
  );
  if (fast) later(100, () => finish(store, repo.mainId, A));
  const cwd = dir === undefined ? repo.main : join(repo.main, dir);
  mkdirSync(cwd, { recursive: true });
  const wait = await waitForNamed(cwd as AbsolutePath, paths, {
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
const REQUIRED = "this repository requires them before you finish: ";
const OPTIONAL = "this repository does not require them before you finish; ";

describe("a named wait that leaves a group's files names the narrow run of them (019-52)", () => {
  it("one left file of a stop group: its own path, not the wait's; the group's run named once", async () => {
    const file = ONE;
    const last = await named([A, file], STOP);
    expect(last).toContain(
      `1 e2e test file waits for a pause or \`squeal run e2e\`, which this wait does not hold for: ${file}; this repository requires it before you finish: \`squeal run e2e ${file} --wait 60000\` runs and waits for it`,
    );
    expect(last).not.toContain(`e2e ${A}`);
    expect(last).not.toContain("`squeal run e2e --wait");
    expect(last.split("`squeal run e2e`").length).toBe(2);
  });

  it("three left files of a manual group: the narrow run runs them now", async () => {
    const files = e2e(3);
    const last = await named(files, MANUAL);
    expect(last).toContain(
      `3 e2e test files wait for \`squeal run e2e\`, which this wait does not hold for: ${files.join(", ")}; ${OPTIONAL}\`squeal run e2e ${files.join(" ")} --wait 60000\` runs them now and waits for their results`,
    );
  });

  it.each([
    ["stop", STOP, `${REQUIRED}`, "runs and waits for them"],
    ["manual", MANUAL, `${OPTIONAL}`, "runs them now and waits for their results"],
  ])(
    "ten left files of a %s group: all ten, in the clause and the command",
    async (_, group, policy, does) => {
      const files = e2e(10);
      const last = await named(files, group);
      expect(last).toContain(
        `which this wait does not hold for: ${files.join(", ")}; ${policy}\`squeal run e2e ${files.join(" ")} --wait 60000\` ${does}`,
      );
      expect(last).not.toContain("more;");
    },
  );

  it.each([
    ["stop", STOP, `${REQUIRED}`, "runs and waits for them"],
    ["manual", MANUAL, `${OPTIONAL}`, "runs them now and waits for their results"],
  ])(
    "eleven left files of a %s group: the whole group's run, no path",
    async (_, group, policy, does) => {
      const files = e2e(11);
      const last = await named(files, group);
      expect(last).toContain(
        `which this wait does not hold for: ${files.slice(0, 10).join(", ")} and 1 more; ${policy}\`squeal run e2e --wait 60000\` ${does}`,
      );
      expect(last).not.toContain("`squeal run e2e test/");
    },
  );

  it("eleven left files of a pause group: the whole group's run waits, as before 019-52", async () => {
    const last = await named(e2e(11), { at: "pause" });
    expect(last).toContain(`${OPTIONAL}\`squeal run e2e --wait 60000\` waits for their results`);
  });

  it("names the CLI by its path in Codex, in both commands", async () => {
    const file = ONE;
    const one = await named([file], STOP, { command: CODEX });
    expect(one).toContain(
      `waits for a pause or \`${CODEX} run e2e\`, which this wait does not hold for: ${file}; this repository requires it before you finish: \`${CODEX} run e2e ${file} --wait 60000\` runs and waits for it`,
    );
    const eleven = await named(e2e(11), MANUAL, { command: CODEX });
    expect(eleven).toContain(`${OPTIONAL}\`${CODEX} run e2e --wait 60000\` runs them now`);
    expect(`${one}${eleven}`).not.toContain("`squeal run");
  });

  it("names the left files shell-quoted, and none of the wait's other paths", async () => {
    const odd = ["test/e2e/two words.test.ts", "test/e2e/it's.test.ts", "test/e2e/$x.test.ts"];
    const last = await named([A, "src/missing.ts", ...odd], STOP, { tests: odd });
    expect(last).toContain(
      `\`squeal run e2e 'test/e2e/two words.test.ts' 'test/e2e/it'\\''s.test.ts' 'test/e2e/$x.test.ts' --wait 60000\` runs and waits for them`,
    );
  });

  it("names the paths from the wait's directory, which the narrow run resolves them against", async () => {
    const files = e2e(2);
    const last = await named(["f00.test.ts", "f01.test.ts"], STOP, {
      tests: files,
      dir: "test/e2e",
    });
    expect(last).toContain(`which this wait does not hold for: ${files.join(", ")}; `);
    expect(last).toContain("`squeal run e2e f00.test.ts f01.test.ts --wait 60000` runs and waits");
    const up = await named(["../e2e/f00.test.ts"], STOP, { tests: [ONE], dir: "test/unit" });
    expect(up).toContain("`squeal run e2e ../e2e/f00.test.ts --wait 60000`");
  });

  it("gives a left file whose path starts with a hyphen ./, so the CLI does not read it as an option", async () => {
    const dash = "test/e2e/-core.test.ts";
    const last = await named(["-core.test.ts"], STOP, { tests: [dash], dir: "test/e2e" });
    expect(last).toContain("`squeal run e2e ./-core.test.ts --wait 60000` runs and waits");
    const root = await named([dash], STOP, { tests: [dash] });
    expect(root).toContain("`squeal run e2e test/e2e/-core.test.ts --wait 60000`");
  });
});
