import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { accepted, describePlayed, forms, play } from "./driver.js";
import { vitest as PACK } from "./packs/vitest.js";
import { SCENARIOS } from "./scenarios/index.js";

/* Spec 016 D1: every kit scenario through Vitest's pack. */

describe("the kit on Vitest (spec 016 D1)", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-kit-vitest-")));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const cases = forms(SCENARIOS, PACK).map((form) => ({
    ...form,
    title: `${form.scenario.name}${form.variant === undefined ? "" : ` (${form.variant})`}: ${form.scenario.title}`,
  }));
  it.each(cases)("$title", { timeout: 120_000 }, async ({ scenario, pack }) => {
    const played = await play(scenario, pack, scratch);
    expect(accepted(played.verdict), describePlayed(played)).toBe(true);
  });
});
