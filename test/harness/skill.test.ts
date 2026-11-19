import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { slowTierText } from "../../src/core/state/slow-text.js";
import { countedText, partsSuffix } from "../../src/core/status/checks.js";
import type { SlowTierState, StatusHeader } from "../../src/core/types/status.js";
import { PLUGIN_DIR } from "../../src/harness/claude-code/build.js";
import { CODEX_RUNTIME_DIR, CODEX_SKILL } from "../../src/harness/codex/build.js";
import { PI_PLUGIN_DIR, PI_SKILL } from "../../src/harness/pi/build.js";
import { PRIMER } from "../../src/harness/shared/primer.js";
import { settled } from "../evals/status-snapshot.js";

/*
 * Task 001-88: the skill fires when the agent is about to run tests or check
 * whether a change broke something; its body is steps first, with reference
 * disclosed in `references/` behind pointers.
 */

const SKILL = join(PLUGIN_DIR, "skills/squeal");
const body = readFileSync(join(SKILL, "SKILL.md"), "utf8");
const references = readdirSync(join(SKILL, "references")).sort();
const read = (name: string) => readFileSync(join(SKILL, "references", name), "utf8");

/** A header whose slow tier has `pending` of 3 files pending, the rest current; `stopWaitMs` with the policy on. */
function slowHeader(pending: number, stopWaitMs?: number): StatusHeader {
  const slowTier: SlowTierState = {
    testFiles: 3,
    current: 3 - pending,
    pending,
    notRun: 0,
    currentAt: pending === 3 ? null : 2,
    activity: null,
    ...(stopWaitMs === undefined ? {} : { stopWaitMs }),
  };
  return { revision: 2, slowTier } as unknown as StatusHeader;
}

function description(): string {
  const match = /^---\n(?:.*\n)*?description: (.*)\n(?:.*\n)*?---\n/.exec(body);
  return match?.[1] ?? "";
}

describe("the squeal skill", () => {
  /*
   * Task 001-283 (`research/primer-skill-writing.md` F5): the description is
   * a context pointer. Row 005-128 (the human, 2026-11-19): it names when to
   * load the skill, the moments the short start message no longer covers
   * (`research/start-message-experiment.md`: loaded in 239 of 240 sessions).
   */
  it("is described by the moments to load it, not by claiming done", () => {
    const text = description();
    expect(text).toMatch(
      /^Use before you run tests yourself, when a test fails or a SQUEAL message reports a failure,/,
    );
    expect(text).toContain("to show that a test catches a bug (fails without the fix)");
    expect(text).toContain("to compare test results with an earlier commit");
    expect(text).toContain("which checks this repository defines");
    expect(text).not.toMatch(/claim|complete|done|Vitest tests|node:test|primer/i);
  });

  it("puts the steps before the reference, and points at every reference file", () => {
    expect(body.indexOf("## Steps")).toBeGreaterThan(-1);
    expect(body.indexOf("## Steps")).toBeLessThan(body.indexOf("## Reference"));
    const pointed = [...body.matchAll(/`references\/([a-z-]+\.md)`/g)].map((m) => m[1]).sort();
    expect(pointed).toEqual(references);
    // Counts and policy keys live in the references, not the body.
    expect(body).not.toContain("| Key |");
    expect(body).not.toContain("**stale**");
  });

  it("says a header names the files changed since the last report, not the cause", () => {
    expect(body).toContain("changed since your last report");
    expect(read("reports.md")).toContain("changed since your last report");
    // Task 001-407: the registration and Stop carry their own form; every other report the news,
    // which names the same files from row 011-262 (review 0.1.379 S1); row 005-94: no counts.
    expect(body).toContain(
      "Other SQUEAL messages carry those files and how many of the test files your edits affect have not run yet; `squeal status` has every count.",
    );
    expect(read("reports.md")).toContain(
      "Every other SQUEAL message carries the news only: the same changed files",
    );
    expect(`${body}${references.map(read).join("")}`).not.toMatch(
      /which edit it is about|leaves out the changed files/,
    );
  });

  // Row 011-262 (review 0.1.379 S1): `reports.md`'s news example and its git-ignored mark are the
  // formatter's own line, and the body points there for the mark.
  it("shows the news line, its changed files and the git-ignored mark as Squeal prints them", () => {
    // Row 005-93 (c): the news line counts the test files the session's edits affect; `null`
    // gives no count (review 0.1.534 N1: an explicit absent count, not the counted default).
    const line = (header: Partial<StatusHeader>, ownEdits: object | null) =>
      formatDelta({
        header: { ...settled, revision: 12, ...header },
        entries: [],
        ...(ownEdits === null ? {} : { ownEdits }),
      } as never)
        .split("\n")
        .find((l) => l.startsWith("Revision 12")) ?? "";
    const changed = { changedPaths: ["src/math.ts"] };
    const owing = { files: 5, owed: 3 };
    for (const news of [line(changed, owing), line(changed, { files: 5, owed: 0 })])
      expect(read("reports.md")).toContain(`\`${news}\``);
    const countFree = line(changed, null);
    expect(countFree).toBe("Revision 12 (changed src/math.ts).");
    expect(read("reports.md")).toContain(`\`${countFree}\``);
    const descriptor = ".ai/qa/test-env.json";
    const marked = line({ changedPaths: [descriptor], ignoredPaths: [descriptor] }, owing);
    expect(marked.startsWith(`Revision 12 (changed git-ignored ${descriptor}): `)).toBe(true);
    expect(read("reports.md")).toContain(`\`(changed git-ignored ${descriptor})\``);
    expect(body).toContain("inherited, `git-ignored`, the slow tier");
  });

  /*
   * Spec 003 lessons, defect 1: "Squeal covers only the Vitest tests" sent
   * agents to run node:test themselves. The skill is static, so it says
   * coverage once, as `squeal checks`' list from `squeal.config.json` (row
   * 005-128: the start message no longer lists it).
   */
  it("says coverage once, as `squeal checks`' list, with node:test and slow files", () => {
    expect(body).toContain("It covers the checks `squeal checks` lists from `squeal.config.json`");
    expect(body).toContain("the node:test tests of the `nodeTest` projects");
    expect(body.match(/`nodeTest`/g)).toHaveLength(1);
    expect(body).not.toMatch(/only the Vitest tests|covers only Vitest/);
  });

  /*
   * Task 001-283 (`research/slow-claims.md` §2): a model following step 3 to
   * the letter claimed while the slow tier ran. The claim step names
   * `run --slow --wait`, and its completion criterion is read off the header.
   * Spec 004 D8 as amended 2026-10-16 (task 004-62, issue #5): the skill is
   * one text in every repository, so it reads the policy off the end of the
   * `Slow tier:` line (`stopText`): Stop's wait means the slow tier is
   * required before done; any other ending means it is not, and a claim
   * that slow tests pass still needs the line current.
   */
  it("reads the slow-suite policy off the `Slow tier:` line, with a checkable criterion", () => {
    const step = body.slice(body.indexOf("6. **"), body.indexOf("7. **"));
    expect(step).toContain("Before you say the task is done");
    expect(step).toContain(
      "If the last one says `Stop waits`, they are required once you edit: while one is not current, run `squeal run --slow --wait 60000`. Without `Stop waits`, say how many are not current.",
    );
    expect(step).toContain("Claim slow tests pass only once it says every slow file is current.");
    expect(step).toContain(
      "Done when no check of your edits is pending, the slow tier is current or counted,",
    );
    expect(body).not.toMatch(/never during Stop's wait/);
    for (const text of [body, ...references.map(read)]) expect(text).not.toContain("Stop's wait");
  });

  /* Both endings, with slow files not current and with every one current. */
  it.each([0, 3])(
    "names the policy's endings as the `Slow tier:` line prints them, %i pending",
    (pending) => {
      const [before, after] = "Stop waits up to … for them or holds the agent once".split("…") as [
        string,
        string,
      ];
      const on = slowTierText(slowHeader(pending, 120_000), "squeal") ?? "";
      expect(on).toContain(`${before}2 min${after}`);
      expect(slowTierText(slowHeader(pending), "squeal")).not.toContain("Stop");
    },
  );

  it("says in `commands.md` that `run --slow` before done is the policy's, read off the line", () => {
    const section = read("commands.md").split("## squeal run --slow")[1] ?? "";
    expect(section).toContain(
      "ask when you need their result now, for example before saying slow tests pass.",
    );
    expect(section).toContain(
      "Whether it is needed before saying the task is done is the repository's policy, read off the end of the `Slow tier:` line (the skill's step 6): `Stop waits up to … for them or holds the agent …` means it is, once you change a file, and Stop keeps you going at most `stop.maxHolds` times in one turn (the line ends `once` at the default 1, else `up to 3 times in a turn`); any other ending means it is not, and a claim that slow tests pass still needs the line to say every slow file is current.",
    );
    expect(section).not.toContain("It is the skill's step 6 before saying the task is done.");
  });

  /*
   * Row 019-27 (spec 019 D4 step 3): with `stop.maxHolds` Stop may hold the
   * agent more than once, so `commands.md` reads the line's ending as
   * `policy.md` does, and quotes both endings as the line prints them.
   */
  it("reads Stop's holds in `commands.md` as `policy.md` does, both endings as printed", () => {
    const section = read("commands.md").split("## squeal run --slow")[1] ?? "";
    expect(section).not.toContain("holds the agent once");
    expect(read("policy.md")).toContain("at most `stop.maxHolds` times in one turn");
    expect(section).toContain("at most `stop.maxHolds` times in one turn");
    const header = (maxHolds?: number) => {
      const base = slowHeader(3, 120_000);
      const slowTier = { ...base.slowTier, ...(maxHolds === undefined ? {} : { maxHolds }) };
      return { ...base, slowTier } as StatusHeader;
    };
    for (const [maxHolds, ending] of [
      [undefined, "once"],
      [3, "up to 3 times in a turn"],
    ] as const) {
      expect(slowTierText(header(maxHolds), "squeal")).toContain(
        `Stop waits up to 2 min for them or holds the agent ${ending}`,
      );
      expect(section).toContain(`\`${ending}\``);
    }
  });

  /*
   * Task 004-67 (issue 19): with the policy on, Stop holds no main agent
   * whose worktree had no revision since it registered; the policy row says
   * so beside the subagent's and the untrusted hook's hold.
   */
  it("says in `policy.md` that a session that changed no file is not held for slow files", () => {
    const row = read("policy.md")
      .split("\n")
      .find((l) => l.startsWith("| `stop.requireSlowSuite`"));
    expect(row).toContain(
      "A main agent whose worktree had no revision since its session registered is not held for slow files: a session that changed no file finishes without them.",
    );
  });

  it("says the same steps, `commands.md` and `policy.md` in the Codex and Pi copies", () => {
    const step = (text: string) =>
      text.slice(text.indexOf("1. **"), text.indexOf("## Reading a header"));
    for (const dir of [join(CODEX_RUNTIME_DIR, CODEX_SKILL), join(PI_PLUGIN_DIR, PI_SKILL)]) {
      expect(step(readFileSync(join(dir, "SKILL.md"), "utf8"))).toBe(step(body));
      expect(readFileSync(join(dir, "references/commands.md"), "utf8")).toBe(read("commands.md"));
      expect(readFileSync(join(dir, "references/policy.md"), "utf8")).toBe(read("policy.md"));
    }
  });

  it("names the squeal why line a FAIL report ends with", () => {
    expect(body).toContain("`Full output: squeal why '<name>'`");
  });

  /*
   * Task 001-174, from 001-172's measurement (`lessons.md`, "`status --wait`
   * on a loaded host"): an agent ran neighbouring suites itself rather than
   * wait. Red/green through the wait, the measured wait for a busy host, and
   * a re-run beside Squeal's named a duplicate. Task 001-283: red/green is a
   * branch only some tasks reach, so it is disclosed in `commands.md` behind
   * a pointer that names it.
   */
  it("shows red/green through the wait, with the measured wait and no duplicate runs", () => {
    const commands = read("commands.md");
    const example = commands.slice(
      commands.indexOf("## Red/green"),
      commands.indexOf("## squeal why"),
    );
    expect(example).toMatch(
      /Revert the fix[\s\S]*status --wait[\s\S]*Restore the fix[\s\S]*status --wait/,
    );
    expect(example).toContain("its own revision");
    expect(example).toContain("PASS -> FAIL");
    // Review wave 13k, S1: quiet is no owed work, not a pass; the outcome is read from the result.
    expect(example).toContain(
      "Quiet says no result your edits owe is outstanding, not that it passed",
    );
    expect(example).toContain("listed under `Known failures` after the revert");
    expect(example).not.toMatch(/quiet means the test (still )?passes/);
    expect(body).toMatch(
      /`references\/commands\.md`:[^\n]*red\/green[^\n]*before a red\/green check/,
    );
    const codex = (name: string) =>
      readFileSync(join(CODEX_RUNTIME_DIR, CODEX_SKILL, "references", name), "utf8");
    expect(codex("commands.md")).toContain(example);
    expect(body).toContain("`--wait 120000` on a busy host");
    expect(read("commands.md")).toContain("On a busy host give it `120000`");
    expect(body).toContain("duplicates what Squeal is already running");
    expect(body).toContain("a gate the repository requires is still yours to run");
  });

  /*
   * Spec 005 D6 (005-15): the deeper layer for agents that load the skill.
   * A new failure's own re-run (001-171) answers whether it is flaky, so the
   * agent does not re-run it; the path form of the wait (D2) is in
   * `skill-wait.test.ts` since 005-68; `squeal why`'s changed-since line
   * (001-225) is explained; a revision is defined once, in the primer, so the
   * header glossary points at it rather than defining it again.
   */
  it("says Squeal re-runs a new failure once, so the agent lets it answer", () => {
    const step = body.slice(body.indexOf("3. **"), body.indexOf("4. **"));
    expect(step).toContain("Squeal re-runs a new failure once on its own");
    expect(step).toContain("`Flaky: FAIL -> PASS under the same tracked inputs`");
    expect(step).toContain("rather than re-running such a failure yourself");
  });

  /*
   * Review wave 3 B2: the re-run is promised only where `queueReruns`
   * (`src/core/scheduler/rerun.ts`) queues one. A forced run's failure
   * (`run --all --force`, a warm-up, a re-run), a key already re-run and a
   * slow file's are left out before the cap, and the cap counts test files
   * failing anew in one tier, not failing tests.
   */
  it("names every failure Squeal does not re-run, as the scheduler decides it", () => {
    const step = body.slice(body.indexOf("3. **"), body.indexOf("4. **"));
    expect(step).toContain(
      "not one from a forced run (`squeal run --all --force`, `squeal warmup`, a re-run), one already re-run at the same inputs, a slow file's, nor any when more than eight eligible test files fail anew in one tier",
    );
    expect(step).not.toContain("more than eight fail anew at once");
  });

  // Row 019-49 raised it from 5,000: the rule for a policy with no test group at `edit` belongs in
  // step 1, which the agent reads right before it runs tests (the coordinator, 2026-11-06).
  // Row 005-94 raised it from 5,100: the human's texts (texts.md 6) add about 160 characters.
  // Row 005-128 raised it from 5,300: the human's steps 1, 4 and 8 and the new description, which
  // carry what the short start message no longer says, add about 1,500 characters.
  it("stays within its budget", () => {
    expect(body.length).toBeLessThan(7_000);
  });

  // Row 005-128: the start message no longer defines a revision; the glossary does, once.
  it("explains `squeal why`'s changed-since line, and defines a revision once, in the glossary", () => {
    expect(read("commands.md")).toContain("a `Changed since revision N:` line lists each path");
    expect(read("reports.md")).toContain(
      "- **revision**: Squeal's number for each saved change to this worktree's files; every result names the revision it ran at. Not a git commit.",
    );
    for (const text of [body, ...references.map(read), PRIMER]) {
      expect(text).not.toContain("A revision is ");
      expect(text).not.toContain("counter of workspace changes");
    }
  });

  /*
   * The human (2026-10-12): 005 words the coverage around 001-292's line. A
   * test file the agent adds is covered when it matches; what else the
   * repository checks, and a file the uncovered-edit line names, is the
   * agent's to run.
   */
  it("says added test files are picked up, and the rest is the agent's to run", () => {
    expect(body).toContain("a test file you add that matches them is picked up too");
    expect(body).toContain("anything else the repository checks are yours to run");
    const step = body.slice(body.indexOf("7. **"), body.indexOf("8. **"));
    expect(step).toContain("`No result for <path>: no test Squeal runs reads it`");
    expect(step).toContain("run whatever tests it yourself");
  });

  // Row 005-128: the retry step (the human's text) waits for the retried file before a claim.
  it("states the next-tool-call default before every `squeal status --wait`", () => {
    const texts = [body, ...references.map(read), PRIMER];
    let pointers = 0;
    for (const text of texts) {
      for (const paragraph of text.split(/\n\s*\n|\n(?=\d+\. |- )/)) {
        const wait = paragraph.indexOf("status --wait");
        if (wait === -1 || paragraph.startsWith("4. **A failure you did not cause**")) continue;
        pointers++;
        const next = paragraph.indexOf("next tool call");
        expect(next, paragraph).toBeGreaterThan(-1);
        expect(next, paragraph).toBeLessThan(wait);
      }
    }
    expect(pointers).toBeGreaterThanOrEqual(3);
  });

  /*
   * Review wave 3 S1 (spec 005 D1, D6): the examples print counts of checks
   * as Squeal does, tests and test files loaded apart, built here by the
   * formatter itself so an example cannot drift from the output.
   */
  it("shows every count of checks with tests and test files loaded apart", () => {
    const counts = (parts: [number, string, number][]) =>
      parts.map(([count, label, files]) => countedText(count, label, files)).join(", ");
    // Row 005-94 (R1): the registration's and Stop's line, as the formatter prints it.
    const known = (testFileCounts: StatusHeader["testFileCounts"]) =>
      formatRegistration({
        header: { ...settled, testFileCounts },
        knownFailures: [],
      } as never)
        .split("\n")
        .find((l) => l.startsWith("Known failures:")) ?? "";
    const r1 = known({ current: 40, pending: 3, stale: 0, unknown: 0 });
    const all = known({ current: 43, pending: 0, stale: 0, unknown: 0 });
    expect(body).toContain(`\`\`${r1}\`\``);
    expect(read("reports.md")).toContain(`\`\`${r1}\`\``);
    expect(read("reports.md")).toContain(`\`\`${all}\`\``);
    expect(read("commands.md")).toContain(
      `Affected checks: ${counts([
        [47, "passed", 7],
        [3, "running", 0],
        [0, "queued", 0],
      ])}\n`,
    );
    expect(read("reports.md")).toContain(
      `\`Inherited from other worktrees: 30 current results${partsSuffix(30, 5)}\``,
    );
    for (const text of [body, read("reports.md"), read("commands.md")]) {
      expect(text).not.toMatch(/\b\d+ current, \d+ pending|\d+ passed, \d+ running/);
    }
  });
});
