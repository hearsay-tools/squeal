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
 * fixture's paths, commits and load readings are named alike. The tool
 * boundaries' texts are compared in order, whichever boundary carried each
 * (review of 0.1.399): a delivery is the same news a boundary later.
 */

const fixture = e2eSuite();

/** The reviewed candidate of 0.1.393 (board, row 010-34). */
const V0_1_393 = "24a8a63b6";

const ALL = [...UNIT_FILES, ...E2E_FILES].length;
/** Every check of the fixture: 5 tests and a file-level check per test file. */
const CHECKS = 5 + ALL;

/** `src/**`'s files, which oxlint lints in the fixture. */
const LINTED = 3;

interface Trace {
  /** SessionStart, the prompt, both Stop entries and `squeal status`, in that order. */
  readonly texts: readonly (string | null)[];
  /** What the tool boundaries delivered, in order, whichever boundary carried each. */
  readonly delivered: readonly string[];
  readonly decisions: readonly (string | null)[];
  readonly ran: readonly string[];
}

/**
 * Every check current, no test file pending, a new failure's confirmation
 * run (001-171) included, and every linted file with `failing` lint
 * verdicts at its current bytes: a boundary then says the same in both
 * versions. `lint.pending` alone reads 0 before the lint pass has keyed a
 * revision, so the edit's own verdict is waited for by its finding.
 */
const settled =
  (failing: number) =>
  (s: StatusSnapshot): boolean =>
    s.counts.current === CHECKS &&
    s.testFileCounts?.pending === 0 &&
    s.lint?.files === LINTED &&
    s.lint.failing === failing &&
    s.lint.pending === 0 &&
    s.lint.stale === 0 &&
    s.lint.unknown === 0;

/** One session: start, a baseline, an edit that breaks a test and adds a lint finding, a commit, Stop. */
async function session(e: E2E, ref?: string): Promise<Trace> {
  pluginAt(e, ref);
  installOxlint(e.main);
  const texts: (string | null)[] = [];
  const delivered: string[] = [];
  const boundary = async () => {
    const out = (await e.hook("post-tool-batch", e.main)).text;
    if (out !== null) delivered.push(named(e, out));
  };
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
  await e.settle(e.main, "the baseline", settled(0));
  step("baseline");
  await boundary();

  const before = (await e.status(e.main)).revision;
  e.write(e.main, "strings", STRINGS_LINTED("?"));
  // The `debugger` line is the one finding: its verdict is the edit's own.
  const edited = (s: StatusSnapshot) => settled(1)(s) && s.knownFailures.length === 2;
  await e.settle(e.main, "the edit and its lint verdict", edited, before);
  step("edit");
  await boundary();

  commitAll(e.main, "a broken shout");
  for (let n = 0; n < 3; n++) {
    await boundary();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  step("commit");

  const stop = await stopBoth(e, e.main);
  texts.push(stop.quick.text, stop.waiting.text);
  step("stop");
  texts.push((await e.cli(e.main, ["status"])).stdout);
  const decisions = [stop.quick.json?.decision ?? null, stop.waiting.json?.decision ?? null];
  const named0 = (t: string | null) => (t === null ? null : named(e, t));
  return { texts: texts.map(named0), delivered, decisions, ran };
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
    expect(now.delivered).toEqual(before.delivered);
    expect(now.texts).toEqual(before.texts.map(accepted));
  }, 600_000);
});
