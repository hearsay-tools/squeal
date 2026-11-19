import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import type { Registration } from "../../src/core/types/delivery.js";
import { primer, withPrimer } from "../../src/harness/shared/primer.js";
import { CODEX } from "../harness/codex-cli.js";
import { graded } from "./reference-sessions.js";
import { settled } from "./status-snapshot.js";

/*
 * Row 005-128: the eval's readers of the start message, gated on the real one in each form
 * (with the skill and without, `squeal` and a Codex path), alone as Pi and OpenCode say it and
 * after a registration as the hooks say it. It carries no evidence, names no check as waiting,
 * and the grader counts it as a registration.
 */

const registration = {
  header: { ...settled, revision: 0 },
  knownFailures: [],
} as never as Registration;

/** Each form: its name, the CLI it names, whether the harness ships the skill, and its text. */
const FORMS = (
  [
    ["skill, squeal", "squeal", true],
    ["no skill, squeal", "squeal", false],
    ["skill, Codex", CODEX, true],
    ["no skill, Codex", CODEX, false],
  ] as const
).map(([name, command, skill]) => [name, primer(command, { skill }), command, skill] as const);

describe("the start message as the eval reads it (row 005-128)", () => {
  it.each(FORMS)("%s: alone it is no evidence", (_, text) => {
    expect(squealEvidence(text, "push")).toBeNull();
  });

  // Review 0.1.565 N3: each case registers with its own CLI, so the Codex cases read a Codex text.
  it.each(FORMS)(
    "%s: after a registration it adds nothing to the registration's",
    (_, text, command, skill) => {
      const full = withPrimer(registration, command, { skill });
      expect(full.endsWith(`\n\n${text}`)).toBe(true);
      expect(full).toContain(`\`${command} `);
      const head = full.slice(0, full.indexOf("\n\nSqueal runs this repository's"));
      const step = squealEvidence(full, "push");
      expect(step).not.toBeNull();
      expect(step).toEqual(squealEvidence(head, "push"));
      expect(step).not.toHaveProperty("waiting");
    },
  );

  it.each(FORMS)("%s: the grader counts it as a registration", (_, text) => {
    const grade = graded([{ squeal: text }], { truthPass: true, status: "pass" });
    expect(grade.deliveries).toMatchObject({ registration: 1, other: 0 });
  });
});
