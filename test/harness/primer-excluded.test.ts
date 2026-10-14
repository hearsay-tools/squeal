import { describe, expect, it } from "vitest";
import { HARNESSES, NOT_COVERED, primerOf, repoFor, sessionStart } from "./primer-helpers.js";

/*
 * Spec 001 D11 (task 001-349): the start's delivery names each Vitest
 * project `vitest.excludeProjects` lists as not run, so the agent knows to
 * run it itself when its change needs it.
 */

describe("the primer names the excluded Vitest projects (001-349)", () => {
  it.each(HARNESSES)("one excluded project, under %s", async (harness) => {
    const r = repoFor({ policy: { vitest: { excludeProjects: ["e2e"] } }, files: [] });
    expect(primerOf(await sessionStart(r, harness)).primer).toContain(
      `Squeal covers Vitest (vitest.config.ts); its project "e2e" is not run, excluded by squeal.config.json. ${NOT_COVERED}`,
    );
  });

  it.each(HARNESSES)("two, under %s", async (harness) => {
    const r = repoFor({ policy: { vitest: { excludeProjects: ["e2e", "bench"] } }, files: [] });
    expect(primerOf(await sessionStart(r, harness)).primer).toContain(
      `Squeal covers Vitest (vitest.config.ts); its projects "e2e" and "bench" are not run, excluded by squeal.config.json. ${NOT_COVERED}`,
    );
  });

  it.each(HARNESSES)("a pattern as a selector, under %s (001-370, review S2)", async (harness) => {
    const r = repoFor({ policy: { vitest: { excludeProjects: ["E*"] } }, files: [] });
    expect(primerOf(await sessionStart(r, harness)).primer).toContain(
      `Squeal covers Vitest (vitest.config.ts); its projects matching "E*" are not run, excluded by squeal.config.json. ${NOT_COVERED}`,
    );
    const both = repoFor({ policy: { vitest: { excludeProjects: ["e2e", "E*"] } }, files: [] });
    expect(primerOf(await sessionStart(both, harness)).primer).toContain(
      `Squeal covers Vitest (vitest.config.ts); its project "e2e" and projects matching "E*" are not run, excluded by squeal.config.json. ${NOT_COVERED}`,
    );
  });

  it.each(HARNESSES)("none without the key, under %s", async (harness) => {
    const text = primerOf(await sessionStart(repoFor({ policy: {}, files: [] }), harness)).primer;
    expect(text).toContain(`Squeal covers Vitest (vitest.config.ts). ${NOT_COVERED}`);
    expect(text).not.toContain("excluded");
  });
});
