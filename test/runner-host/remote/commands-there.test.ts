import { describe, expect, it } from "vitest";
import {
  commandNames,
  commandNeeds,
  commandsLine,
} from "../../../src/core/daemon/required-commands.js";
import {
  type CommandLook,
  type CommandsThere,
  commandsThere,
  type VersionFact,
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

/** A connect's answer: the names looked for, those missing there, the version checks run. */
function facts(
  checked: readonly string[],
  missing: readonly string[] = [],
  versions: readonly VersionFact[] = [],
): CommandsThere {
  return { checked, missing, versions };
}

/** `google-chrome <version>`'s first lines here and there. */
function chrome(version: string, here: string | null, there: string | null): VersionFact {
  return { command: "google-chrome", version, here, there };
}

describe("requires.commands on a remote at connect (row 026-36)", () => {
  it("refuses for the array form and for *, with D19.1's text, as before", async () => {
    expect(await commandsThere(["git", "python3"], look({ git: "" }))).toEqual({
      refusal: "tests need python3; not found on PATH there",
    });
    expect(await commandsThere({ "*": ["python3"], [E2E]: ["google-chrome"] }, look({}))).toEqual({
      refusal: "tests need python3; not found on PATH there",
    });
    expect(await commandsThere(["git"], look({ git: "" }))).toEqual(facts(["git"]));
    expect(await commandsThere([], look({}))).toEqual(facts([]));
  });

  it("answers a glob's missing command without a refusal", async () => {
    const found = await commandsThere(
      { "*": ["git"], [E2E]: ["google-chrome"] },
      look({ git: "" }),
    );
    expect(found).toEqual(facts(["git", "google-chrome"], ["google-chrome"]));
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
    expect(found).toEqual(
      facts(
        ["google-chrome", "git"],
        [],
        [chrome("--version", "Google Chrome 131.0", "Google Chrome 120.0")],
      ),
    );
    expect(remote.asked).toEqual(["google-chrome --version"]);
    expect(commandRoute({ [E2E]: ["git"] }, found as CommandsThere, "vm-1").globs).toEqual([]);
  });

  it("takes no version check for a command missing here, and refuses a * command of another version", async () => {
    const versioned = [{ command: "google-chrome", version: "--version" }];
    const missingHere = look({ "google-chrome": "Google Chrome 120.0" }, {});
    const found = await commandsThere({ [E2E]: versioned }, missingHere);
    expect(found).toEqual(facts(["google-chrome"], [], [chrome("--version", null, null)]));
    expect(missingHere.asked).toEqual([]);
    expect(commandRoute({ [E2E]: versioned }, found as CommandsThere, "vm-1").globs).toEqual([]);
    const differs = look({ "google-chrome": "Chrome 120" }, { "google-chrome": "Chrome 131" });
    expect(await commandsThere({ "*": versioned }, differs)).toEqual({
      refusal: 'tests need the same version of google-chrome "Chrome 120" there, "Chrome 131" here',
    });
  });
});

describe("version checks count by command and argument (review 0.1.656 B4)", () => {
  const git = (version: string) => ({ command: "git", version });
  /** A remote with git, whose `git <arg>` prints `there[arg]`; here prints `here[arg]`. */
  const gitLook = (
    there: Readonly<Record<string, string>>,
    here: Readonly<Record<string, string>>,
  ): CommandLook => ({
    missing: async () => [],
    version: async (need) => there[need.version] ?? "",
    versionHere: (need) => here[need.version] ?? null,
  });
  const differs = gitLook({ "--version": "git 2.43" }, { "--version": "git 2.51" });

  it("keeps only the versioned glob here when a plain glob names the same command", async () => {
    const required = { "test/plain/**": ["git"], "test/versioned/**": [git("--version")] };
    const found = (await commandsThere(required, differs)) as CommandsThere;
    expect(commandRoute(required, found, "vm-1")).toEqual({
      globs: ["test/versioned/**"],
      text: 'vm-1 has git "git 2.43", this machine "git 2.51", for test/versioned/**; these files run here; add it to remote.setup',
      provisional: false,
    });
  });

  it("does not refuse for a plain * name when only a glob's version differs", async () => {
    const required = { "*": ["git"], "test/versioned/**": [git("--version")] };
    const found = (await commandsThere(required, differs)) as CommandsThere;
    expect(found.versions).toEqual([
      { command: "git", version: "--version", here: "git 2.51", there: "git 2.43" },
    ]);
    expect(commandRoute(required, found, "vm-1").globs).toEqual(["test/versioned/**"]);
  });

  it("keeps apart two version arguments of one command", async () => {
    const look = gitLook(
      { "--version": "git 2.43", "-v": "same" },
      { "--version": "git 2.51", "-v": "same" },
    );
    const required = { "a/**": [git("--version")], "b/**": [git("-v")] };
    const found = (await commandsThere(required, look)) as CommandsThere;
    expect(commandRoute(required, found, "vm-1").globs).toEqual(["a/**"]);
    // A `*` entry refuses on its own argument's check only.
    expect(
      await commandsThere({ "*": [git("-v")], "a/**": [git("--version")] }, look),
    ).not.toHaveProperty("refusal");
    expect(await commandsThere({ "*": [git("--version")], "b/**": [git("-v")] }, look)).toEqual({
      refusal: 'tests need the same version of git "git 2.43" there, "git 2.51" here',
    });
  });
});

describe("a reloaded policy routes by the connect's facts (review 0.1.656 B3)", () => {
  it("keeps a command found missing missing when its glob moves", () => {
    const there = facts(["chrome"], ["chrome"]);
    expect(commandRoute({ "test/new/**": ["chrome"] }, there, "vm-1")).toEqual({
      globs: ["test/new/**"],
      text: "vm-1 lacks chrome for test/new/**; these files run here; add it to remote.setup",
      provisional: false,
    });
  });

  it("keeps a version check the connect did not run here, named, until the next connect", () => {
    const presence = facts(["git"]);
    const versioned = { "test/web/**": [{ command: "git", version: "--version" }] };
    expect(commandRoute(versioned, presence, "vm-1")).toEqual({
      globs: ["test/web/**"],
      text: "git --version not yet looked for on vm-1 for test/web/**; these files run here until it connects again",
      provisional: true,
    });
    const checked = facts(
      ["git"],
      [],
      [{ command: "git", version: "--version", here: "a", there: "a" }],
    );
    expect(commandRoute(versioned, checked, "vm-1").globs).toEqual([]);
    const other = { "test/web/**": [{ command: "git", version: "-v" }] };
    expect(commandRoute(other, checked, "vm-1").globs).toEqual(["test/web/**"]);
  });

  it("keeps every file here when a reload adds a * command the connect did not find", () => {
    const there = facts(["git"], [], []);
    expect(commandRoute({ "*": ["git"] }, there, "vm-1")).toEqual({
      globs: [],
      text: null,
      provisional: false,
    });
    expect(commandRoute(["git", "python3"], there, "vm-1")).toEqual({
      globs: ["**"],
      text: "python3 not yet looked for on vm-1 for every test file; these files run here until it connects again",
      provisional: true,
    });
    expect(commandRoute({ "*": ["chrome"] }, facts(["chrome"], ["chrome"]), "vm-1").globs).toEqual([
      "**",
    ]);
  });
});

describe("the files a remote lacks a command for, named (row 026-36)", () => {
  it("names the glob and the fix, as D13.2 writes it", () => {
    const required = { "*": ["git"], [E2E]: ["google-chrome"] };
    const there = facts(["git", "google-chrome"], ["google-chrome"]);
    expect(commandRoute(required, there, "agent37")).toEqual({
      globs: [E2E],
      text: `agent37 lacks google-chrome for ${E2E}; these files run here; add it to remote.setup`,
      provisional: false,
    });
    expect(commandRoute(required, facts(["git", "google-chrome"]), "agent37")).toEqual({
      globs: [],
      text: null,
      provisional: false,
    });
  });

  it("names a version that differs, and several commands as them", () => {
    const required = {
      [E2E]: [{ command: "google-chrome", version: "--version" }, "ffmpeg"],
      "test/py/**": ["python3"],
    };
    const there = facts(
      ["google-chrome", "ffmpeg", "python3"],
      ["ffmpeg"],
      [chrome("--version", "131", "120")],
    );
    expect(commandRoute(required, there, "vm-1")).toEqual({
      globs: [E2E],
      text: `vm-1 lacks ffmpeg for ${E2E}; vm-1 has google-chrome "120", this machine "131", for ${E2E}; these files run here; add them to remote.setup`,
      provisional: false,
    });
  });

  it("keeps every per-file glob here before a connect answered, and one named after it, until the next", () => {
    const required = { [E2E]: ["google-chrome"], "*": ["git"] };
    expect(commandRoute(required, null, "vm-1")).toEqual({
      globs: [E2E],
      text: null,
      provisional: true,
    });
    expect(commandRoute(["git"], null, "vm-1")).toEqual({
      globs: [],
      text: null,
      provisional: false,
    });
    const later = { ...required, "test/py/**": ["python3"] };
    expect(commandRoute(later, facts(["google-chrome", "git"]), "vm-1")).toEqual({
      globs: ["test/py/**"],
      text: "python3 not yet looked for on vm-1 for test/py/**; these files run here until it connects again",
      provisional: true,
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
