import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addChecks,
  assertChecksAccepted,
  checksProblem,
  situationOf,
} from "../../evals/lib/index.mjs";

// Row 005-127: the `checks` knob of a12-manual-check, a check group committed into the fixture's
// config before the warm-up, and the guard that skips a cell whose CLI does not accept it.
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const CONTRACT = {
  name: "contract",
  runner: "vitest",
  tests: ["test/contract/**"],
  at: "manual",
  description: "The invoice JSON against the billing API's schema.",
};

describe("the checks knob", () => {
  it("adds the groups to the fixture's config, keeps its keys, and commits it", () => {
    const work = mkdtempSync(join(tmpdir(), "squeal-check-knob-"));
    dirs.push(work);
    const before = { slow: { include: ["test/slow/**"] } };
    writeFileSync(join(work, "squeal.config.json"), JSON.stringify(before));
    const git: string[][] = [];
    const log: string[] = [];
    addChecks({ checks: [CONTRACT] }, { work, git: (a) => git.push(a), log: (l) => log.push(l) });
    const after = JSON.parse(readFileSync(join(work, "squeal.config.json"), "utf8"));
    expect(after).toEqual({ ...before, checks: [CONTRACT] });
    expect(git).toEqual([
      ["commit", "-q", "-m", "Name the test checks", "--", join(work, "squeal.config.json")],
    ]);
    expect(log).toEqual(["checks: contract at manual"]);
  });

  it("leaves a fixture without the knob as it was", () => {
    const git: string[][] = [];
    addChecks({}, { work: "/nonexistent", git: (a) => git.push(a), log: () => {} });
    expect(git).toEqual([]);
  });

  it("skips a cell only on a config problem line", () => {
    expect(
      checksProblem(
        'Revision: 0\nConfig problem: squeal.config.json: "checks[0]" has unknown key "description" (`squeal setup --check` names each)',
      ),
    ).toBe(true);
    expect(checksProblem("Revision: 0\nKnown failures: 0\nDaemon: alive")).toBe(false);
  });

  it("fails the cell's setup on a config problem line, naming it (review B2)", () => {
    const text =
      'Revision: 0\nConfig problem: squeal.config.json: "checks[0]" has unknown key "description"';
    expect(() => assertChecksAccepted(text)).toThrow(
      /does not accept the checks knob's config: Config problem: squeal\.config\.json: "checks\[0\]"/,
    );
    expect(() => assertChecksAccepted("Revision: 0\nKnown failures: 0")).not.toThrow();
  });

  it("tells the judge the check runs only on request", () => {
    expect(situationOf({ checks: [CONTRACT] })).toMatch(
      /defines a check `contract` \(test\/contract\/\*\*\) that runs only on request: after an edit it does not run and waits for `squeal run contract`/,
    );
  });
});
