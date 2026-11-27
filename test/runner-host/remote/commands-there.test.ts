import { describe, expect, it } from "vitest";
import {
  commandNames,
  commandNeeds,
  commandsLine,
} from "../../../src/core/daemon/required-commands.js";
import {
  type CommandLook,
  commandsThere,
} from "../../../src/core/runner-host/remote/commands-there.js";
import { commandRoute } from "../../../src/core/runner-host/remote/lane-commands.js";

/*
 * Spec 026 D13.2 (row 026-36): `requires.commands` per test file. At connect
 * a command every test needs, missing or of another version on the remote,
 * refuses it, as the array form did (021 D19.1); one only a glob's files
 * need keeps those files here, named in status with the fix.
 */

/** A remote whose `PATH` holds `there`, each with its version's first line; this machine holds `here`. */
function look(
  there: Readonly<Record<string, string>>,
  here: Readonly<Record<string, string>> = there,
): CommandLook & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    missing: async (commands) => commands.filter((name) => !(name in there)),
    version: async (need) => {
      asked.push(`${need.command} ${need.version}`);
      return there[need.command] ?? "";
    },
    versionHere: (need) => here[need.command] ?? null,
  };
}

const E2E = "packages/web/e2e/*.e2e.ts";

describe("requires.commands on a remote at connect (row 026-36)", () => {
  it("refuses for the array form and for *, with D19.1's text, as before", async () => {
    expect(await commandsThere(["git", "python3"], look({ git: "" }))).toEqual({
      refusal: "tests need python3; not found on PATH there",
    });
    expect(await commandsThere({ "*": ["python3"], [E2E]: ["google-chrome"] }, look({}))).toEqual({
      refusal: "tests need python3; not found on PATH there",
    });
    expect(await commandsThere(["git"], look({ git: "" }))).toEqual({
      checked: ["git"],
      files: [],
    });
    expect(await commandsThere([], look({}))).toEqual({ checked: [], files: [] });
  });

  it("answers a glob's missing command without a refusal", async () => {
    const found = await commandsThere(
      { "*": ["git"], [E2E]: ["google-chrome"] },
      look({ git: "" }),
    );
    expect(found).toEqual({
      checked: ["git", "google-chrome"],
      files: [{ glob: E2E, missing: ["google-chrome"], differing: [] }],
    });
  });

  it("compares a version entry's first line on both machines; a plain name takes no version check", async () => {
    const remote = look(
      { "google-chrome": "Google Chrome 120.0", git: "git version 2.43.0" },
      { "google-chrome": "Google Chrome 131.0", git: "git version 2.51.0" },
    );
    const found = await commandsThere(
      { [E2E]: [{ command: "google-chrome", version: "--version" }, "git"] },
      remote,
    );
    expect(found).toEqual({
      checked: ["google-chrome", "git"],
      files: [
        {
          glob: E2E,
          missing: [],
          differing: [
            { command: "google-chrome", here: "Google Chrome 131.0", there: "Google Chrome 120.0" },
          ],
        },
      ],
    });
    expect(remote.asked).toEqual(["google-chrome --version"]);
    const equal = { "google-chrome": "Google Chrome 131.0" };
    const same = { [E2E]: [{ command: "google-chrome", version: "--version" }] };
    expect(await commandsThere(same, look(equal))).toEqual({
      checked: ["google-chrome"],
      files: [],
    });
  });

  it("takes no version check for a command missing here, and refuses a * command of another version", async () => {
    const versioned = [{ command: "google-chrome", version: "--version" }];
    const missingHere = look({ "google-chrome": "Google Chrome 120.0" }, {});
    expect(await commandsThere({ [E2E]: versioned }, missingHere)).toEqual({
      checked: ["google-chrome"],
      files: [],
    });
    expect(missingHere.asked).toEqual([]);
    const differs = look({ "google-chrome": "Chrome 120" }, { "google-chrome": "Chrome 131" });
    expect(await commandsThere({ "*": versioned }, differs)).toEqual({
      refusal: 'tests need the same version of google-chrome "Chrome 120" there, "Chrome 131" here',
    });
  });
});

describe("the files a remote lacks a command for, named (row 026-36)", () => {
  it("names the glob and the fix, as D13.2 writes it", () => {
    const required = { "*": ["git"], [E2E]: ["google-chrome"] };
    const there = {
      checked: ["git", "google-chrome"],
      files: [{ glob: E2E, missing: ["google-chrome"], differing: [] }],
    };
    expect(commandRoute(required, there, "agent37")).toEqual({
      globs: [E2E],
      text: `agent37 lacks google-chrome for ${E2E}; these files run here; add it to remote.setup`,
    });
    expect(
      commandRoute(required, { checked: ["git", "google-chrome"], files: [] }, "agent37"),
    ).toEqual({
      globs: [],
      text: null,
    });
  });

  it("names a version that differs, and several commands as them", () => {
    const required = { [E2E]: ["google-chrome", "ffmpeg"], "test/py/**": ["python3"] };
    const there = {
      checked: ["google-chrome", "ffmpeg", "python3"],
      files: [
        {
          glob: E2E,
          missing: ["ffmpeg"],
          differing: [{ command: "google-chrome", here: "131", there: "120" }],
        },
      ],
    };
    expect(commandRoute(required, there, "vm-1")).toEqual({
      globs: [E2E],
      text: `vm-1 lacks ffmpeg for ${E2E}; vm-1 has google-chrome "120", this machine "131", for ${E2E}; these files run here; add them to remote.setup`,
    });
  });

  it("keeps every per-file glob here before a connect answered, and one named after it, until the next", () => {
    const required = { [E2E]: ["google-chrome"], "*": ["git"] };
    expect(commandRoute(required, null, "vm-1")).toEqual({ globs: [E2E], text: null });
    expect(commandRoute(["git"], null, "vm-1")).toEqual({ globs: [], text: null });
    const later = { ...required, "test/py/**": ["python3"] };
    expect(commandRoute(later, { checked: ["google-chrome", "git"], files: [] }, "vm-1")).toEqual({
      globs: ["test/py/**"],
      text: "python3 not yet looked for on vm-1 for test/py/**; these files run here until it connects again",
    });
  });

  it("looks here for every name of either form", () => {
    const needs = commandNeeds({
      "*": ["git"],
      [E2E]: ["git", { command: "squeal-absent-tool", version: "-v" }],
    });
    expect(commandNames(needs)).toEqual(["git", "squeal-absent-tool"]);
    expect(commandsLine({ [E2E]: ["squeal-absent-tool"] }, undefined)).toBe(
      "tests need squeal-absent-tool; not found on PATH here",
    );
  });
});
