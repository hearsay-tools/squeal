import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupTierText } from "../../src/core/state/group-text.js";
import { PLUGIN_DIR } from "../../src/harness/claude-code/build.js";

/*
 * Row 019-16 (spec 019 D6 "Skill", Testing "Texts"): the skill's policy
 * reference lists `checks`, `stop.maxHolds` and the host config's
 * `capacity.groupSlotScope`, and its reports reference shows a group's line
 * as status prints it.
 */

const SKILL = join(PLUGIN_DIR, "skills", "squeal", "references");
const read = (name: string) => readFileSync(join(SKILL, name), "utf8");

describe("the skill's references for check groups (019-16)", () => {
  it("list `checks`, `stop.maxHolds` and `capacity.groupSlotScope` as keys", () => {
    const policy = read("policy.md");
    for (const key of ["checks", "stop.maxHolds", "capacity.groupSlotScope"]) {
      expect(policy).toContain(`| \`${key}\` |`);
    }
    expect(policy).toContain("## Host config");
    for (const moment of ['`"edit"`', '`"pause"`', '`"stop"`', '`"commit"`']) {
      expect(policy).toContain(moment);
    }
  });

  it("say Stop's holds count per turn from the prompt, and name a group's command (019-23)", () => {
    const policy = read("policy.md");
    expect(policy).toContain("at most `stop.maxHolds` times in one turn");
    expect(policy).toContain("Squeal counts these holds from your prompt");
    expect(policy).toContain("`squeal run e2e --wait`");
  });

  it("show a group's status line as Squeal prints it", () => {
    const line = groupTierText(
      {
        name: "e2e",
        at: "stop",
        after: [],
        quietMs: 0,
        testFiles: 12,
        current: 3,
        pending: 9,
        notRun: 0,
        currentAt: 40,
        activity: { kind: "waiting", for: "idle" },
        stopWaitMs: 120_000,
      },
      42,
      false,
      "squeal",
    );
    expect(read("reports.md")).toContain(`\`\`${line}\`\``);
  });
});
