import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { accepted, describePlayed, play } from "./driver.js";
import { nodeTest } from "./packs/node-test.js";
import { SCENARIOS } from "./scenarios/index.js";

/* Spec 016 D1: every kit scenario through node:test's pack. */

describe("the kit on node:test (spec 016 D1)", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-kit-node-test-")));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it.each(SCENARIOS)("$name: $title", { timeout: 120_000 }, async (scenario) => {
    const played = await play(scenario, nodeTest, scratch);
    expect(accepted(played.verdict), describePlayed(played)).toBe(true);
  });
});
