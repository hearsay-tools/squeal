import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { installJest, JEST_MAJORS } from "../helpers/jest-env.js";
import { forms, play } from "./driver.js";
import { jestPack } from "./packs/jest.js";
import { SCENARIOS } from "./scenarios/index.js";
import { accepted, describePlayed } from "./verdicts.js";

/* Spec 016 D1, spec 028 D6.2: every kit scenario through Jest's pack, on Jest 29 and Jest 30. */

describe.each(JEST_MAJORS)("the kit on Jest %i (spec 016 D1)", (major) => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), `squeal-kit-jest-${major}-`)));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const cases = forms(
    SCENARIOS,
    jestPack(major, () => installJest(major)),
  ).map((form) => ({
    ...form,
    title: `${form.scenario.name}${form.variant === undefined ? "" : ` (${form.variant})`}: ${form.scenario.title}`,
  }));
  it.each(cases)("$title", { timeout: 300_000 }, async ({ scenario, pack }) => {
    const played = await play(scenario, pack, scratch);
    expect(accepted(played.verdict), describePlayed(played)).toBe(true);
  });
});
