import { describe, expect, it } from "vitest";
import { bridgeDeps } from "../../src/harness/opencode/bridge.js";
import {
  PRIMER_CAP_CHARS,
  PRIMER_FORM,
  primer,
  trailingPrimer,
} from "../../src/harness/shared/primer.js";

/*
 * Row 005-126 (wave 30): the primer's form switch. `"full"` is the shipped
 * primer, which every other primer test pins; `"minimal"` and
 * `"minimal-rules"` are the brief's forms B and C, word for word.
 */

const B =
  "Squeal runs this repository's checks in the background and tells you with your next tool call when one changes; a pass is silent. `squeal checks` lists the checks this repository defines and when each runs. `squeal status` gives the current results, `squeal run <check>` runs one now, `squeal retry <file>` repeats a failure caused by load or a stopped service. `squeal --help` has the rest.";

const C =
  "Squeal runs this repository's checks in the background and tells you with your next tool call when one changes; a pass is silent. Do not run the tests yourself to learn whether an edit broke something. Before you say you are done, `squeal status --wait 60000` gives the verdict. `squeal checks` lists the checks this repository defines and when each runs. `squeal status` gives the current results, `squeal run <check>` runs one now, `squeal retry <file>` repeats a failure caused by load or a stopped service. `squeal --help` has the rest.";

const SKILL =
  "Squeal runs this repository's checks in the background and tells you with your next tool call when one changes; a pass is silent. Read the squeal skill before you run or judge tests: it says what to do instead of a hand run, and with a failure you did not cause. `squeal checks` lists this repository's checks and when each runs; `squeal status` gives the current results.";

const NO_SKILL =
  "Squeal runs this repository's checks in the background and tells you with your next tool call when one changes; a pass is silent. Do not run the tests yourself to learn whether an edit broke something. A check that does not run after an edit: `squeal run <check> --wait 60000`. A failure you did not cause, from load or a stopped service: `squeal retry <file> --reason load|environment`, then claim from that result. Before you say you are done: `squeal status --wait 60000`. `squeal checks` lists this repository's checks and when each runs.";

const CODEX = "/opt/codex/plugins/squeal/bin/squeal";

/** Each short form, the skill form with and without the harness's skill. */
const FORMS = [
  ["minimal", true],
  ["minimal-rules", true],
  ["skill", true],
  ["skill", false],
] as const;

describe("the primer's forms (row 005-126)", () => {
  it("ships the full form", () => {
    expect(PRIMER_FORM).toBe("full");
    expect(primer()).toBe(primer(undefined, undefined, { form: "full" }));
  });

  it("says form B, minimal, exactly", () => {
    expect(primer(undefined, undefined, { form: "minimal" })).toBe(B);
  });

  it("says form C, minimal with rules, exactly", () => {
    expect(primer(undefined, undefined, { form: "minimal-rules" })).toBe(C);
  });

  it("sends the agent to the skill in a harness that ships it", () => {
    expect(primer(undefined, undefined, { form: "skill" })).toBe(SKILL);
    expect(primer(undefined, undefined, { form: "skill", skill: true })).toBe(SKILL);
  });

  it("says the rules itself in a harness with no skill", () => {
    expect(primer(undefined, undefined, { form: "skill", skill: false })).toBe(NO_SKILL);
  });

  it("ignores the skill in the other forms", () => {
    expect(primer(undefined, undefined, { form: "full", skill: false })).toBe(primer());
    expect(primer(undefined, undefined, { form: "minimal", skill: false })).toBe(B);
  });

  it("names a Codex CLI in the skill forms in full first and as the CLI's after it", () => {
    expect(primer(CODEX, undefined, { form: "skill" })).toBe(
      SKILL.replace("`squeal checks`", `\`${CODEX} checks\``).replace(
        "`squeal status`",
        "the CLI's `status`",
      ),
    );
    expect(primer(CODEX, undefined, { form: "skill", skill: false })).toBe(
      NO_SKILL.replace("`squeal run", `\`${CODEX} run`)
        .replace("`squeal retry", "the CLI's `retry")
        .replace("`squeal status", "the CLI's `status")
        .replace("`squeal checks`", "The CLI's `checks`"),
    );
  });

  it("names a Codex CLI in full in its first command and as the CLI's after it", () => {
    expect(primer(CODEX, undefined, { form: "minimal" })).toBe(
      `Squeal runs this repository's checks in the background and tells you with your next tool call when one changes; a pass is silent. \`${CODEX} checks\` lists the checks this repository defines and when each runs. The CLI's \`status\` gives the current results, the CLI's \`run <check>\` runs one now, the CLI's \`retry <file>\` repeats a failure caused by load or a stopped service. The CLI's \`--help\` has the rest.`,
    );
    expect(primer(CODEX, undefined, { form: "minimal-rules" })).toContain(
      `Before you say you are done, \`${CODEX} status --wait 60000\` gives the verdict. The CLI's \`checks\` lists`,
    );
  });

  it("leaves a CLI too long to name unnamed, within the cap", () => {
    const long = `/${"x".repeat(2_000)}/squeal`;
    for (const [form, skill] of FORMS) {
      const text = primer(long, undefined, { form, skill });
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
      expect(text).not.toContain(long);
      expect(text).toMatch(/`checks` lists (the|this repository's) checks/);
      expect(text).toMatch(/These are commands of the CLI SQUEAL messages name\.$/);
    }
  });

  it("is found as a hook's trailing primer in each form", () => {
    for (const [form, skill] of FORMS) {
      const text = primer(undefined, undefined, { form, skill });
      expect(trailingPrimer(`header\n\n${text}`)).toBe(`\n\n${text}`);
    }
  });

  it("is told by OpenCode's deps that its harness has no skill", () => {
    const deps = bridgeDeps(new URL("file:///pkg/dist/hooks/after.mjs"), { worktree: "/", pid: 1 });
    expect(deps.skill).toBe(false);
  });
});
