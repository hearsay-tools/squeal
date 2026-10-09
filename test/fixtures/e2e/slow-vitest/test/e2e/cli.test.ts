import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// The built CLI, run as a user runs it: no import reaches it, so only a declared input keys it.
const CLI = fileURLToPath(new URL("../../dist/cli.mjs", import.meta.url));

it("shouts through the built CLI", () => {
  expect(execFileSync(process.execPath, [CLI, "hi"], { encoding: "utf8" })).toBe("HI!\n");
});
