import { describe, expect, it } from "vitest";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { type E2E, e2eSuite, PLUGINS } from "./harness.js";
import {
  E2E_FILES,
  LINTED,
  STRINGS_LINTED,
  triggersFixture,
  UNIT_FILES,
} from "./run-triggers-fixture.js";
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
  return loadNamed(
    text
      .replaceAll(e.base, "<fixture>")
      .replace(/\/versions\/\d+\.\d+\.\d+\//g, "/versions/<version>/")
      .replace(/\b[0-9a-f]{7,40}\b/g, "<sha>"),
  );
}

const FAILED_FILE = [...UNIT_FILES, ...E2E_FILES].map((f) => f.replaceAll(".", "\\.")).join("|");
const NO_RETRY = " when it ran; no retry asked at these inputs";
/** A load reading; after a known failure's reading, the load retry it may name (row 011-67). */
const LOAD_READING = new RegExp(
  `load (\\d+(?:\\.\\d+)?) per CPU(${NO_RETRY}` +
    `(; (?:if the changed files are not the cause, )?\`[^\`]+ retry (?:${FAILED_FILE}) --reason load\`` +
    " runs it once more when the one-minute load average is below the CPU count)?)?",
  "g",
);

/**
 * `text` with every load reading named alike (row 019-41). A known failure
 * recorded at a load of one per CPU or more names a load retry, in 0.1.393 as
 * now; the two sessions run minutes apart, so on a busy runner one session's
 * failure can be recorded busy and the other's idle. The retry is named
 * alike with its reading when it agrees with it (the printed reading is
 * rounded, so 1.00 agrees either way); one that does not keeps its reading
 * and its retry as printed, so the comparison shows it.
 */
function loadNamed(text: string): string {
  return text.replace(LOAD_READING, (reading, load: string, known?: string, retry?: string) => {
    if (known === undefined) return "load <n> per CPU";
    const perCpu = Number(load);
    const agrees = retry === undefined ? perCpu <= 1 : perCpu >= 1;
    return agrees ? `load <n> per CPU${NO_RETRY}` : reading;
  });
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

describe("the control's load readings (row 019-41)", () => {
  const FILES = [...UNIT_FILES, ...E2E_FILES];
  const LEAD =
    "no pass at these inputs is on record before this failure: look first at the changed files it reads; ";
  /** A known failure of `file` as `squeal status` prints it, at `load`, with `retry` after it. */
  const failure = (file: string, load: string, retry: string, lead = LEAD) =>
    `  FAIL  [unit] ${file} > shouts\n        ${lead}recorded just now in this worktree at revision 1, load ${load} per CPU when it ran; no retry asked at these inputs${retry}`;
  /** The load retry for `file`, as both versions print it at a load of one per CPU or more. */
  const retry = (
    file: string,
    { when = "if the changed files are not the cause, ", command = "squeal", reason = "load" } = {},
  ) =>
    `; ${when}\`${command} retry ${file} --reason ${reason}\` runs it once more when the one-minute load average is below the CPU count`;
  const idle = (file: string, lead = LEAD) => loadNamed(failure(file, "0.42", "", lead));

  it("names a failure recorded busy, with its own load retry, as its twin recorded idle", () => {
    for (const file of FILES) {
      expect(loadNamed(failure(file, "1.55", retry(file))), file).toBe(idle(file));
      expect(loadNamed(failure(file, "1.00", retry(file))), file).toBe(idle(file));
      expect(loadNamed(failure(file, "1.00", "")), file).toBe(idle(file));
      expect(loadNamed(failure(file, "1.55", retry(file, { when: "" }), "")), file).toBe(
        idle(file, ""),
      );
    }
    const [flow, strings] = ["test/e2e/flow.test.ts", "test/strings.test.ts"];
    const both = (load: string, a: string, b: string) =>
      loadNamed(`${failure(flow, load, a)}\n${failure(strings, load, b)}`);
    expect(both("1.55", retry(flow), retry(strings))).toBe(both("0.42", "", ""));
    expect(both("1.55", retry(strings), retry(flow))).not.toBe(both("0.42", "", ""));
    expect(loadNamed("replaced by PASS, load 2.10 per CPU")).toBe(
      "replaced by PASS, load <n> per CPU",
    );
  });

  it("keeps a load retry for every other fixture file", () => {
    for (const file of FILES) {
      for (const other of FILES.filter((f) => f !== file)) {
        expect(loadNamed(failure(file, "1.55", retry(other))), `${file}: ${other}`).not.toBe(
          idle(file),
        );
        expect(loadNamed(failure(file, "0.42", retry(other))), `${file}: ${other}`).not.toBe(
          idle(file),
        );
      }
    }
  });

  it("keeps a missing, extra, unknown, changed or unattached load retry", () => {
    for (const file of FILES) {
      const kept = {
        missing: failure(file, "1.55", ""),
        extra: failure(file, "0.42", retry(file)),
        "unknown path": failure(file, "1.55", retry("test/e2e/other.test.ts")),
        "other reason": failure(file, "1.55", retry(file, { reason: "environment" })),
        "other command": failure(file, "1.55", retry(file, { command: "node squeal.mjs" })),
        "no changed-files clause": failure(file, "1.55", retry(file, { when: "" })),
        "a clause with no lead": failure(file, "1.55", retry(file), ""),
        "a changed sentence": failure(file, "1.55", `${retry(file)}.`),
      };
      for (const [mutation, text] of Object.entries(kept)) {
        const twin = idle(file, mutation === "a clause with no lead" ? "" : LEAD);
        expect(loadNamed(text), `${file}: ${mutation}`).not.toBe(twin);
      }
      const facts = (load: string, after: string) =>
        loadNamed(failure(file, load, after).split("\n")[1] ?? "");
      expect(facts("1.55", retry(file)), `${file}: no failure`).not.toBe(facts("0.42", ""));
    }
  });
});
