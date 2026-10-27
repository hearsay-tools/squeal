import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startGroup } from "../../../src/runners/process/group.js";
import { tempDir } from "../../store/helpers.js";

/*
 * Spec 005 D3 (row 005-88): the shared process-group launcher labels no
 * process by itself. A caller that passes no argv0, as pytest's runner,
 * starts its command with the command as argv0; only an explicit one is
 * used, and the arguments after it stay apart.
 */

async function argv0Of(argv0?: string): Promise<{ argv0: string; argv: string[] }> {
  const dir = tempDir("squeal-group-argv0-");
  const group = startGroup({
    command: process.execPath,
    args: [
      "-e",
      "console.log(JSON.stringify({ argv0: process.argv0, argv: process.argv.slice(1) }))",
      "a b",
      "--flag",
    ],
    cwd: dir,
    env: process.env,
    stdout: join(dir, "out"),
    stderr: join(dir, "err"),
    ...(argv0 === undefined ? {} : { argv0 }),
  });
  expect(await group.exited).toEqual({ code: 0, signal: null, error: null });
  return JSON.parse(readFileSync(join(dir, "out"), "utf8"));
}

describe("startGroup's argv0 (005-88)", () => {
  it("is the command when the caller passes none", async () => {
    expect(await argv0Of()).toEqual({ argv0: process.execPath, argv: ["a b", "--flag"] });
  });

  it("is the caller's label when it passes one, the arguments unchanged", async () => {
    expect(await argv0Of("squeal p node-test @01234567")).toEqual({
      argv0: "squeal p node-test @01234567",
      argv: ["a b", "--flag"],
    });
  });
});
