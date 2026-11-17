import { describe, expect, it } from "vitest";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { wordingPass } from "./control-wording.js";
import { type E2E, e2eSuite } from "./harness.js";
import { PLUGINS } from "./plugins.js";
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

const NO_RETRY = " when it ran; no retry asked at these inputs";
const BELOW = "` runs it once more when the one-minute load average is below the CPU count";
/** A load reading; after a known failure's reading, the load retry it may name (row 011-67). */
const LOAD_READING = new RegExp(
  `load (\\d+(?:\\.\\d+)?) per CPU(${NO_RETRY}(; [^\\n]*?${BELOW})?)?`,
  "g",
);
/** A known failure's first line, `FAIL  [unit] test/strings.test.ts > shouts`, in status and in a delivery. */
const FAILURE = /^\s*FAIL {2}(?:\[[^\]]+\] )?(\S+) > /;
/** The lead of a failure with no pass at its inputs on record before it (row 011-253). */
const FRESH =
  "no pass at these inputs is on record before this failure: look first at the changed files it reads; ";

/** The load retry 0.1.393 and now name for a failure of `file` recorded busy (`loadRetryText`). */
const loadRetry = (file: string, fresh: boolean) =>
  `; ${fresh ? "if the changed files are not the cause, " : ""}\`squeal retry ${file} --reason load${BELOW}`;

/**
 * `text` with every load reading named alike (row 019-41). A known failure
 * recorded at a load of one per CPU or more names a load retry, in 0.1.393 as
 * now; the two sessions run minutes apart, so on a busy runner one session's
 * failure can be recorded busy and the other's idle. A retry is named alike
 * with its reading only when it is the very retry both versions print for the
 * failure above it (its file, `squeal`, `--reason load`, the changed-files
 * clause after that lead) and the reading agrees with it (the printed reading
 * is rounded, so 1.00 agrees either way). Any other reading with a retry, and
 * a busy one with none, keeps its reading and its retry as printed, so the
 * comparison shows it (review 0.1.402 B3).
 */
function loadNamed(text: string): string {
  let file: string | null = null;
  const line = (printed: string) => {
    if (/^\s*FAIL\s/.test(printed)) file = FAILURE.exec(printed)?.[1] ?? null;
    const fresh = printed.toLowerCase().includes(FRESH);
    return printed.replace(
      LOAD_READING,
      (reading, load: string, known?: string, retry?: string) => {
        if (known === undefined) return "load <n> per CPU";
        const perCpu = Number(load);
        const agrees =
          retry === undefined
            ? perCpu <= 1
            : file !== null && retry === loadRetry(file, fresh) && perCpu >= 1;
        return agrees ? `load <n> per CPU${NO_RETRY}` : reading;
      },
    );
  };
  return text.split("\n").map(line).join("\n");
}

/**
 * The one change a repository with no `checks` key sees: the boundary after a
 * commit asks the daemon for a pass (019 D5, the report stored for every
 * commit), so status knows the committed tree is clean at once, where 0.1.393
 * said "dirty not known" until its idle pass, up to 30 s later. Row 005-94's
 * wording pass is `wordingPass`, applied last.
 */
const accepted = (text: string | null) =>
  text === null
    ? null
    : wordingPass(
        ownCount(
          contentTitle(
            noResultsYet(sharedImports(text.replace(/ \+ 0, dirty not known\n/, " + 0\n"))),
          ),
        ),
        ALL,
      );

/** 0.1.393's news header with nothing pending, then its merged first-edit and settled line. */
const SETTLED_NEWS =
  /^(Revision [^\n]*?): no check pending, stale or unknown\.\nSqueal saw your edit; (?:all (\d+) test files|the 1 test file) it re-keyed (?:are|is) current, and passing results stay silent\.$/m;

/**
 * Row 005-93 (c), part 5: a news header counts the test files the session's edits affect in
 * place of the worktree's queue, and the settled line (001-223) is gone. Beside the edit's own
 * results, with nothing pending, the first-edit line is left out (001-396), so 0.1.393's header
 * and merged line are one own count: `the 2 test files your edits affect have all run.`
 */
function ownCount(text: string): string {
  return text.replace(SETTLED_NEWS, (_, revision: string, files?: string) =>
    files === undefined
      ? `${revision}: the 1 test file your edits affect has run.`
      : `${revision}: the ${files} test files your edits affect have all run.`,
  );
}

/** 0.1.393's sentence and count lines for a worktree whose test files are not listed yet. */
const UNLISTED =
  /^(Revision [^:\n]*: )[^\n]*? The daemon has not listed this worktree's test files yet; these counts are not complete\.(?: Full-suite checkpoint: [^\n]*?requests one\)\.)?/m;

/**
 * Row 005-90: before the listing, a registration or news header prints no counts, no
 * checkpoint sentence and no zero known-failure count; one sentence names the path wait.
 */
function noResultsYet(text: string): string {
  if (!UNLISTED.test(text)) return text;
  const command = /`([^`\s]+) (?:run|status|lint)\b/.exec(text)?.[1] ?? "squeal";
  const sentence =
    "Squeal is still starting in this worktree and has no results yet. " +
    `\`${command} status --wait 60000 <path>...\` waits for the files you change.`;
  return text
    .replace(UNLISTED, (_, revision: string) => `${revision}${sentence}`)
    .replace(/^Known failures: 0; the daemon has not listed this worktree's test files yet\n/m, "");
}

/**
 * Row 005-91 (c): a delivery 0.1.393 titled `SQUEAL · revision N` is titled by its lines'
 * words (`contentWords`): the edit lines, the owed counts (a news header with the current
 * count), the slow tier's kind, a lint line with no change to count, and a commit.
 */
function contentTitle(text: string): string {
  const [first = "", ...rest] = text.split("\n");
  const revision = /^SQUEAL · revision (\d+)$/.exec(first)?.[1];
  if (revision === undefined) return text;
  const words = rest.flatMap(lineWords);
  if (words.length === 0) return text;
  return [`SQUEAL · ${words.join("; ")} at revision ${revision}`, ...rest].join("\n");
}

function lineWords(line: string): string[] {
  const queued = /^Squeal saw your edit(?: and queued|, which re-keyed) (\d+ test files?)/.exec(
    line,
  );
  if (queued !== null) {
    return [`your edit ${line.includes("re-keyed") ? "affects" : "queued"} ${queued[1]}`];
  }
  if (/^Squeal saw your edit; |your edits since revision \d+ re-keyed/.test(line)) {
    return [
      `your edits' test files ${/ current(?:,|\.)/.test(line) && !/unknown/.test(line) ? "are current" : "finished"}`,
    ];
  }
  // Row 005-94: the owed counts' title without the word "listing".
  if (/^Revision [^:]*: \d+ current\b/.test(line)) return ["first results in this worktree"];
  if (line.startsWith("Slow tier:")) {
    return [
      `slow tier ${/\d+ pending/.test(line) ? "waiting" : /not run/.test(line) ? "not run" : "current"}`,
    ];
  }
  if (line.startsWith("Lint config changed:")) return ["lint config changed"];
  if (/^Lint: \d+ files? with findings/.test(line)) return ["lint summary"];
  if (line.startsWith("Lint: unknown:")) return ["lint unknown"];
  if (line.startsWith("Lint: off:")) return ["lint off"];
  const commit = /^Commit (\S+?):/.exec(line)?.[1];
  return commit === undefined ? [] : [`commit ${commit}`];
}

/** A failure block's line on its changed imports, as 0.1.393 printed it in every block. */
const CLOSURE = /^ {6}its closure reads (files changed here since this session started: .*)$/;

/**
 * Row 005-92: failure blocks that state the same changed imports say them
 * once, after the blocks and before `Full output:`, where 0.1.393 said them
 * in each block. A text with one such line, or with lines that differ, is
 * unchanged, as the product leaves it.
 */
function sharedImports(text: string): string {
  const lines = text.split("\n");
  const stated = lines.flatMap((l) => CLOSURE.exec(l)?.[1] ?? []);
  if (stated.length < 2 || stated.some((s) => s !== stated[0])) return text;
  const once = `All ${stated.length} failing tests import ${stated[0]}`;
  return lines
    .filter((l) => !CLOSURE.test(l))
    .join("\n")
    .replace("\n\nFull output:", `\n\n${once}\n\nFull output:`);
}

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
    expect(now.delivered).toEqual(before.delivered.map(accepted));
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
