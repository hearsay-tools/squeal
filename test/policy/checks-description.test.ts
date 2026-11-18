import { describe, expect, it } from "vitest";
import { useLoad } from "./checks-load.js";

/*
 * Row 005-126: a check's optional `description`, one line of at most 200
 * characters, on a test group and on a lint group; anything else is a
 * problem in the loader's style, and the group is left out.
 */

const load = useLoad();
const unit = { name: "unit", runner: "vitest", at: "edit" };
const lint = { name: "style", lint: true, at: "commit" };

describe("a check's description (row 005-126)", () => {
  it.each([
    ["a test group", { ...unit, description: "The unit tests." }],
    ["a lint group", { ...lint, description: "ESLint over the source." }],
    ["200 characters", { ...unit, description: "x".repeat(200) }],
  ])("keeps %s with a description", (_, group) => {
    const { policy, problems } = load({ checks: [group] });
    expect(problems).toEqual([]);
    expect(policy.checks).toEqual([group]);
  });

  it.each([
    ["201 characters", "x".repeat(201)],
    ["two lines", "first\nsecond"],
    ["a carriage return", "first\rsecond"],
    ["an empty string", ""],
    ["blanks only", "   "],
    ["a number", 3],
    ["null", null],
    ["a list", ["a"]],
  ])("leaves out a group whose description is %s", (_, description) => {
    const { policy, problems } = load({
      checks: [
        { ...unit, description },
        { ...lint, description },
      ],
    });
    const got = JSON.stringify(description);
    expect(problems).toEqual([
      `"checks[0].description" must be one line of 1 to 200 characters, got ${got}; group "unit" is left out`,
      `"checks[1].description" must be one line of 1 to 200 characters, got ${got}; group "style" is left out`,
    ]);
    expect(policy.checks).toEqual([]);
  });
});
