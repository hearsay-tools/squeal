import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { slowTierText } from "../../src/core/state/slow-text.js";
import { countedText } from "../../src/core/status/checks.js";
import type { SlowTierState, StatusHeader } from "../../src/core/types/index.js";
import { PLUGIN_DIR } from "../../src/harness/claude-code/build.js";
import { CODEX_PLUGIN_DIR, CODEX_SKILL } from "../../src/harness/codex/build.js";
import { PI_PLUGIN_DIR, PI_SKILL } from "../../src/harness/pi/build.js";
import { PRIMER } from "../../src/harness/shared/primer.js";

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
   * a context pointer; its trigger stays the human's (001-88), and coverage,
   * which the static text said wrong for a node:test-only repository, is the
   * primer's list, read from the config.
   */
  it("is described by running tests and checking for breakage, not by claiming done", () => {
    const text = description();
    expect(text).toMatch(/^Use when about to run tests \(vitest, npm test\)/);
    expect(text).toContain("check whether a change broke something");
    expect(text).toContain("the suites its primer lists as covered");
    expect(text).not.toMatch(/claim|complete|done|Vitest tests|node:test/i);
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
    // Task 001-407: only the registration and Stop do; every other report carries the news.
    expect(body).toContain("Other SQUEAL messages carry the news, non-zero counts only");
    expect(read("reports.md")).toContain("Every other SQUEAL message carries the news only");
    expect(`${body}${references.map(read).join("")}`).not.toMatch(/which edit it is about/);
  });

  /*
   * Spec 003 lessons, defect 1: "Squeal covers only the Vitest tests" sent
   * agents to run node:test themselves. The skill is static, so it says
   * coverage once, as the primer's list from `squeal.config.json`.
   */
  it("says coverage once, as the primer's list, with node:test and slow files", () => {
    expect(body).toContain("It covers what the SQUEAL primer lists from `squeal.config.json`");
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
    const step = body.slice(body.indexOf("4. **"), body.indexOf("5. **"));
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
      "Whether it is needed before saying the task is done is the repository's policy, read off the end of the `Slow tier:` line (the skill's step 4): `Stop waits up to … for them or holds the agent once` means it is, once you change a file; any other ending means it is not, and a claim that slow tests pass still needs the line to say every slow file is current.",
    );
    expect(section).not.toContain("It is the skill's step 4 before saying the task is done.");
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

  it("says the same step 4, `commands.md` and `policy.md` in the Codex and Pi copies", () => {
    const step = (text: string) => text.slice(text.indexOf("4. **"), text.indexOf("5. **"));
    for (const dir of [join(CODEX_PLUGIN_DIR, CODEX_SKILL), join(PI_PLUGIN_DIR, PI_SKILL)]) {
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
      readFileSync(join(CODEX_PLUGIN_DIR, CODEX_SKILL, "references", name), "utf8");
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
    const step = body.slice(body.indexOf("2. **"), body.indexOf("3. **"));
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
    const step = body.slice(body.indexOf("2. **"), body.indexOf("3. **"));
    expect(step).toContain(
      "not one from a forced run (`squeal run --all --force`, `squeal warmup`, a re-run), one already re-run at the same inputs, a slow file's, nor any when more than eight eligible test files fail anew in one tier",
    );
    expect(step).not.toContain("more than eight fail anew at once");
  });

  it("stays within its budget", () => {
    expect(body.length).toBeLessThan(5_000);
  });

  it("explains `squeal why`'s changed-since line, and defines a revision only in the primer", () => {
    expect(read("commands.md")).toContain("a `Changed since revision N:` line lists each path");
    expect(read("reports.md")).toContain("- **revision**: as the SQUEAL primer defines it;");
    for (const text of [body, ...references.map(read)]) {
      expect(text).not.toContain("A revision is ");
      expect(text).not.toContain("counter of workspace changes");
    }
    expect(PRIMER).toContain("A revision is Squeal's number for each saved change");
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
    const step = body.slice(body.indexOf("5. **"), body.indexOf("## Reading a header"));
    expect(step).toContain("`No result for <path>: no test Squeal runs reads it`");
    expect(step).toContain("run whatever tests it yourself");
  });

  it("states the next-tool-call default before every `squeal status --wait`", () => {
    const texts = [body, ...references.map(read), PRIMER];
    let pointers = 0;
    for (const text of texts) {
      for (const paragraph of text.split(/\n\s*\n|\n(?=\d+\. |- )/)) {
        const wait = paragraph.indexOf("status --wait");
        if (wait === -1) continue;
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
    const validity = (current: number, files: number, pending: number, stale = 0, unknown = 0) =>
      counts([
        [current, "current", files],
        [pending, "pending", 0],
        [stale, "stale", 0],
        [unknown, "unknown", 0],
      ]);
    expect(body).toContain(`\`Revision 21 (changed src/math.ts): ${validity(40, 6, 3)}.\``);
    expect(read("reports.md")).toContain(`\`Revision 12: ${validity(40, 6, 3, 1, 2)}.\``);
    expect(read("commands.md")).toContain(
      `Affected checks: ${counts([
        [47, "passed", 7],
        [3, "running", 0],
        [0, "queued", 0],
      ])}\n`,
    );
    expect(read("reports.md")).toContain(
      "`Inherited: 30 of 40 current (25 tests, 5 test files loaded).`",
    );
    for (const text of [body, read("reports.md"), read("commands.md")]) {
      expect(text).not.toMatch(/\b\d+ current, \d+ pending|\d+ passed, \d+ running/);
    }
  });
});
