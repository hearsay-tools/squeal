import { describe, expect, it } from "vitest";
import { bridgeDeps } from "../../src/harness/opencode/bridge.js";
import {
  PRIMER,
  PRIMER_CAP_CHARS,
  primer,
  trailingPrimer,
} from "../../src/harness/shared/primer.js";

/*
 * Row 005-128 (spec 005 D6 as amended 2026-11-19): the start message, in a
 * harness that ships the squeal skill and in one that does not, word for
 * word as the human approved them.
 */

const SKILL =
  "Squeal runs this repository's checks in the background and tells you with your next tool call when one changes; a pass is silent. Read the squeal skill before you run or judge tests: it says what to do instead of a hand run, and with a failure you did not cause. `squeal checks` lists this repository's checks and when each runs; `squeal status` gives the current results.";

const NO_SKILL =
  "Squeal runs this repository's checks in the background and tells you with your next tool call when one changes; a pass is silent. Do not run the tests yourself to learn whether an edit broke something. A check that does not run after an edit: `squeal run <check> --wait 60000`. A failure you did not cause, from load or a stopped service: `squeal retry <file> --reason load|environment`, then claim from that result. Before you say you are done: `squeal status --wait 60000`. `squeal checks` lists this repository's checks and when each runs.";

const CODEX = "/opt/codex/plugins/squeal/bin/squeal";

describe("the start message (row 005-128)", () => {
  it("sends the agent to the skill in a harness that ships it", () => {
    expect(PRIMER).toBe(SKILL);
    expect(primer()).toBe(SKILL);
    expect(primer(undefined, { skill: true })).toBe(SKILL);
  });

  it("says the rules itself in a harness with no skill", () => {
    expect(primer(undefined, { skill: false })).toBe(NO_SKILL);
  });

  it("names a Codex CLI in full first and as the CLI's after it", () => {
    expect(primer(CODEX)).toBe(
      SKILL.replace("`squeal checks`", `\`${CODEX} checks\``).replace(
        "`squeal status`",
        "the CLI's `status`",
      ),
    );
    expect(primer(CODEX, { skill: false })).toBe(
      NO_SKILL.replace("`squeal run", `\`${CODEX} run`)
        .replace("`squeal retry", "the CLI's `retry")
        .replace("`squeal status", "the CLI's `status")
        .replace("`squeal checks`", "The CLI's `checks`"),
    );
  });

  it("leaves a CLI too long to name unnamed, within the cap", () => {
    const long = `/${"x".repeat(2_000)}/squeal`;
    for (const skill of [true, false]) {
      const text = primer(long, { skill });
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
      expect(text).not.toContain(long);
      expect(text).toContain("`checks` lists this repository's checks");
      expect(text).toMatch(/These are commands of the CLI SQUEAL messages name\.$/);
    }
  });

  it("is found as a hook's trailing primer in each form", () => {
    for (const skill of [true, false]) {
      const text = primer(undefined, { skill });
      expect(trailingPrimer(`header\n\n${text}`)).toBe(`\n\n${text}`);
    }
  });

  it("is told by OpenCode's deps that its harness has no skill", () => {
    const deps = bridgeDeps(new URL("file:///pkg/dist/hooks/after.mjs"), { worktree: "/", pid: 1 });
    expect(deps.skill).toBe(false);
  });
});
