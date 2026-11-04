import { describe, expect, it } from "vitest";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { type E2E, e2eSuite, PLUGINS } from "./harness.js";
import { E2E_FILES, STRINGS_LINTED, triggersFixture, UNIT_FILES } from "./run-triggers-fixture.js";
import {
  commitAll,
  installOxlint,
  pluginAt,
  promptOnceStored,
  stopBoth,
  timedRuns,
} from "./run-triggers-support.js";

/*
 * Spec 019 Goal 2, end to end (row 019-17): the repository of
 * `run-triggers.test.ts` with no `checks` key behaves as 0.1.393, the release
 * before spec 019, did. One session runs on the plugin of 0.1.393's reviewed
 * candidate and the same session on this worktree's: every text the agent
 * gets, the Stop decisions and the files each step ran are equal, once the
 * fixture's paths, commits and load readings are named alike.
 */

const fixture = e2eSuite();

/** The reviewed candidate of 0.1.393 (board, row 010-34). */
const V0_1_393 = "24a8a63b6";

const ALL = [...UNIT_FILES, ...E2E_FILES].length;
/** Every check of the fixture: 5 tests and a file-level check per test file. */
const CHECKS = 5 + ALL;

interface Trace {
  readonly texts: readonly (string | null)[];
  readonly decisions: readonly (string | null)[];
  readonly ran: readonly string[];
}

/**
 * Every check current, no test file pending, a new failure's confirmation
 * run (001-171) included, and lint done: a boundary then says the same in
 * both versions.
 */
const settled = (s: StatusSnapshot) =>
  s.counts.current === CHECKS &&
  s.testFileCounts?.pending === 0 &&
  (s.lint === undefined || s.lint.pending === 0);

/** One session: start, a baseline, an edit that breaks a test and adds a lint finding, a commit, Stop. */
async function session(e: E2E, ref?: string): Promise<Trace> {
  pluginAt(e, ref);
  installOxlint(e.main);
  const texts: (string | null)[] = [];
  const ran: string[] = [];
  const step = (name: string) => {
    const runs = timedRuns(e, e.main);
    ran.push(`${name}: ${[...new Set(runs.slice(seen).flatMap((r) => r.testFiles))].sort()}`);
    seen = runs.length;
  };
  let seen = 0;
  texts.push((await e.hook("session-start", e.main)).text);
  texts.push((await promptOnceStored(e)).text);
  await e.daemonReady(e.main);
  await e.settle(e.main, "the baseline", settled);
  step("baseline");
  texts.push((await e.hook("post-tool-batch", e.main)).text);

  const before = (await e.status(e.main)).revision;
  e.write(e.main, "strings", STRINGS_LINTED("?"));
  await e.settle(e.main, "the edit", (s) => settled(s) && s.knownFailures.length === 2, before);
  step("edit");
  texts.push((await e.hook("post-tool-batch", e.main)).text);

  commitAll(e.main, "a broken shout");
  for (let boundary = 0; boundary < 3; boundary++) {
    texts.push((await e.hook("post-tool-batch", e.main)).text);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  step("commit");

  const stop = await stopBoth(e, e.main);
  texts.push(stop.quick.text, stop.waiting.text);
  step("stop");
  texts.push((await e.cli(e.main, ["status"])).stdout);
  const decisions = [stop.quick.json?.decision ?? null, stop.waiting.json?.decision ?? null];
  return { texts: texts.map((t) => (t === null ? null : named(e, t))), decisions, ran };
}

/** `text` with the fixture's paths, Codex's runtime folder, commit names and load readings named alike. */
function named(e: E2E, text: string): string {
  return text
    .replaceAll(e.base, "<fixture>")
    .replace(/\/versions\/\d+\.\d+\.\d+\//g, "/versions/<version>/")
    .replace(/\b[0-9a-f]{7,40}\b/g, "<sha>")
    .replace(/load \d+(\.\d+)? per CPU/g, "load <n> per CPU");
}

/**
 * The one change a repository with no `checks` key sees: the boundary after a
 * commit asks the daemon for a pass (019 D5, the report stored for every
 * commit), so status knows the committed tree is clean at once, where 0.1.393
 * said "dirty not known" until its idle pass, up to 30 s later.
 */
const accepted = (text: string | null) =>
  text?.replace(/ \+ 0, dirty not known\n/, " + 0\n") ?? null;

describe.each(PLUGINS)("a repository with no checks key, $name (019 Goal 2)", (plugin) => {
  it("tells the agent what 0.1.393 told it, and Stop decides as it did", async (ctx) => {
    const options = triggersFixture(false);
    const before = await session(fixture(ctx, plugin, options), V0_1_393);
    const now = await session(fixture(ctx, plugin, options));
    expect(before.ran).toEqual([
      `baseline: ${[...E2E_FILES, ...UNIT_FILES].sort()}`,
      "edit: test/e2e/flow.test.ts,test/strings.test.ts",
      "commit: ",
      "stop: ",
    ]);
    expect(now.ran).toEqual(before.ran);
    expect(now.decisions).toEqual(before.decisions);
    expect(now.texts).toEqual(before.texts.map(accepted));
  }, 600_000);
});
