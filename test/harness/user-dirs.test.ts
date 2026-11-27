import { describe, expect, it } from "vitest";
import { machinesPath } from "../../src/core/runner-host/remote/machines-store.js";
import { remoteSettingsPath } from "../../src/core/runner-host/remote/settings.js";
import { runShell } from "../e2e/shell.js";
import { runNode } from "./bundle-helpers.js";
import { testUserDirs } from "./user-dirs.js";

/*
 * Review 0.1.658 B5: the helpers that start the shipped CLI with the real
 * HOME give it private config and state directories, so its remote config
 * and machine registry are never the user's. `remote-prune-sentinel.test.ts`
 * proves it with a real daemon; this checks each helper's environment.
 */

const home = process.env.HOME ?? "";
const PRINT =
  "console.log(JSON.stringify({ c: process.env.XDG_CONFIG_HOME, s: process.env.XDG_STATE_HOME }))";

function expectPrivate(out: string): void {
  const { c, s } = JSON.parse(out) as { c: string; s: string };
  expect({ c, s }).toEqual({ c: testUserDirs().XDG_CONFIG_HOME, s: testUserDirs().XDG_STATE_HOME });
  const env = { HOME: home, XDG_CONFIG_HOME: c, XDG_STATE_HOME: s };
  expect(remoteSettingsPath(env).startsWith(`${home}/`)).toBe(false);
  expect(machinesPath(env).startsWith(`${home}/`)).toBe(false);
}

describe("test helpers never hand a CLI the user's remote files (review 0.1.658 B5)", () => {
  it("runNode", async () => {
    expectPrivate((await runNode(["-e", PRINT], "")).stdout);
  });

  it("runShell", async () => {
    const run = await runShell("sh", `"${process.execPath}" -e '${PRINT}'`, "", process.cwd(), {});
    expectPrivate(run.stdout);
  });

  it("an env that names its own directories keeps them", async () => {
    const run = await runNode(["-e", PRINT], "", { XDG_CONFIG_HOME: "/c", XDG_STATE_HOME: "/s" });
    expect(JSON.parse(run.stdout)).toEqual({ c: "/c", s: "/s" });
  });
});
