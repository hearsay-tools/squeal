import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  commandsLine,
  MISSING_SCRIPT,
  missingCommands,
} from "../../src/core/daemon/required-commands.js";

/*
 * Spec 021 D19.1 (row 021-23): the commands the tests need on `PATH`, looked
 * for here by the daemon and on a remote by `MISSING_SCRIPT`, the same test.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-required-commands-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const bin = join(scratch, "bin");
const other = join(scratch, "other");
mkdirSync(bin, { recursive: true });
mkdirSync(join(other, "folder"), { recursive: true });
writeFileSync(join(bin, "tool"), "#!/bin/sh\n");
chmodSync(join(bin, "tool"), 0o755);
writeFileSync(join(other, "plain"), "not executable\n");
chmodSync(join(other, "plain"), 0o644);
const env = { PATH: [bin, "", other].join(delimiter) };
const NAMES = ["tool", "plain", "folder", "absent"];

describe("requires.commands looked for on PATH (021 D19.1)", () => {
  it("names each command no PATH directory holds as an executable file, in order", () => {
    expect(missingCommands(NAMES, env)).toEqual(["plain", "folder", "absent"]);
    expect(missingCommands(["tool"], env)).toEqual([]);
    expect(missingCommands(["tool"], {})).toEqual(["tool"]);
  });

  it("finds the same on a remote, through its Node", () => {
    const printed = execFileSync(process.execPath, ["-e", MISSING_SCRIPT, ...NAMES], {
      env,
      encoding: "utf8",
    });
    expect(JSON.parse(printed)).toEqual(missingCommands(NAMES, env));
  });

  it("names a missing command in status, once, and says so when it is found again", () => {
    const missing = commandsLine(["tool", "absent"], undefined, env);
    expect(missing).toBe("tests need absent; not found on PATH here");
    expect(commandsLine(["tool", "absent"], missing ?? undefined, env)).toBeNull();
    expect(commandsLine(["tool", "absent", "plain"], missing ?? undefined, env)).toBe(
      "tests need absent, plain; not found on PATH here",
    );
    expect(commandsLine(["tool"], missing ?? undefined, env)).toBe(
      "tests need tool; all found on PATH here",
    );
    expect(commandsLine([], missing ?? undefined, env)).toBe(
      "tests need no command (requires.commands is empty)",
    );
  });

  it("says nothing when nothing was ever missing", () => {
    expect(commandsLine(["tool"], undefined, env)).toBeNull();
    expect(commandsLine([], undefined, env)).toBeNull();
  });
});
