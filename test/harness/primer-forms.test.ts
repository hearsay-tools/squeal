import { describe, expect, it } from "vitest";
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

const CODEX = "/opt/codex/plugins/squeal/bin/squeal";

describe("the primer's forms (row 005-126)", () => {
  it("ships the full form", () => {
    expect(PRIMER_FORM).toBe("full");
    expect(primer()).toBe(primer(undefined, undefined, "full"));
  });

  it("says form B, minimal, exactly", () => {
    expect(primer(undefined, undefined, "minimal")).toBe(B);
  });

  it("says form C, minimal with rules, exactly", () => {
    expect(primer(undefined, undefined, "minimal-rules")).toBe(C);
  });

  it("names a Codex CLI in full in its first command and as the CLI's after it", () => {
    expect(primer(CODEX, undefined, "minimal")).toBe(
      `Squeal runs this repository's checks in the background and tells you with your next tool call when one changes; a pass is silent. \`${CODEX} checks\` lists the checks this repository defines and when each runs. The CLI's \`status\` gives the current results, the CLI's \`run <check>\` runs one now, the CLI's \`retry <file>\` repeats a failure caused by load or a stopped service. The CLI's \`--help\` has the rest.`,
    );
    expect(primer(CODEX, undefined, "minimal-rules")).toContain(
      `Before you say you are done, \`${CODEX} status --wait 60000\` gives the verdict. The CLI's \`checks\` lists`,
    );
  });

  it("leaves a CLI too long to name unnamed, within the cap", () => {
    const long = `/${"x".repeat(2_000)}/squeal`;
    for (const form of ["minimal", "minimal-rules"] as const) {
      const text = primer(long, undefined, form);
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
      expect(text).not.toContain(long);
      expect(text).toContain("`checks` lists the checks");
      expect(text).toMatch(/These are commands of the CLI SQUEAL messages name\.$/);
    }
  });

  it("is found as a hook's trailing primer in each form", () => {
    for (const form of ["minimal", "minimal-rules"] as const) {
      const text = primer(undefined, undefined, form);
      expect(trailingPrimer(`header\n\n${text}`)).toBe(`\n\n${text}`);
    }
  });
});
