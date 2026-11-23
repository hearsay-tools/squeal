import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_INSTALL_COMMAND, antigravityCli } from "../../src/cli/antigravity/install.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { rootVersion } from "../../src/harness/build.js";
import { tempDir } from "../store/helpers.js";
import { expectAgrees } from "./agree.js";
import { ANTIGRAVITY, ANTIGRAVITY_SESSION } from "./antigravity-plugin.js";
import { type E2E, e2eSuite, HOOK_BUDGET_MS } from "./harness.js";
import { copyPlugin } from "./plugins.js";
import { MATH } from "./sources.js";
import { registeredSessions } from "./support.js";

/*
 * Spec 024 Testing, end to end, what only Antigravity has: the committed
 * `plugins/antigravity` copied as `plugin install` copies it, each hook run
 * from the plugin root as Antigravity runs it (`antigravity-plugin.ts`),
 * against a real daemon and the fixture's real Vitest. D1: the version copy
 * in `PLUGIN_DATA` keeps the daemon and the CLI working while an update
 * replaces the plugin root. D2: a subagent's conversation is a consumer of
 * its own. D8 and D3: `run_command` is denied only for an answered test
 * command, once, and allowed with empty stdout. D6: `squeal status` in an
 * unregistered conversation says so. D1: a live `plugin validate` of the copy.
 * The Stop entries are in `antigravity-stop.test.ts`.
 */

const fixture = e2eSuite();
const VERSION = rootVersion();
const ADDS = "test/math.test.ts > math > adds";
const SUBAGENT = "00000000-0000-4000-8000-000000000002";
const quiet = (s: StatusSnapshot) => s.knownFailures.length === 0;
const failing = (s: StatusSnapshot) =>
  s.knownFailures.length === 1 && s.knownFailures[0]?.validity === "current";

/** The daemon of `e.main` started and its passing baseline settled. */
async function baseline(e: E2E): Promise<number> {
  const start = await e.hook("session-start", e.main);
  expect(start).toMatchObject({ code: 0, stderr: "" });
  const { pid } = await e.daemonReady(e.main);
  await e.settle(e.main, "a passing baseline", (s) => s.counts.current > 0 && quiet(s));
  return pid;
}

/** The registration of a conversation whose SessionStart ran before the store existed (D3). */
async function registered(e: E2E, overrides: object = {}): Promise<void> {
  const first = await e.hook("post-tool-batch", e.main, overrides);
  expect(first.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
}

/** `run_command` with `CommandLine` through the plugin's PreToolUse (D3). */
const runCommand = (e: E2E, CommandLine: string) =>
  e.hook("pre-tool-use", e.main, {
    toolCall: {
      args: { CommandLine, WaitMsBeforeAsync: 1000 },
      id: "call_e2e",
      name: "run_command",
    },
  });

describe("Antigravity's PLUGIN_DATA version copy (spec 024 D1)", () => {
  it("keeps the daemon and the CLI working after the plugin root is deleted", async (ctx) => {
    const e = fixture(ctx, ANTIGRAVITY);
    const data = e.env.PLUGIN_DATA ?? "";
    const copy = join(data, "versions", VERSION);
    const launcher = join(data, "bin/squeal");
    const pid = await baseline(e);

    // SessionStart kept this version's copy and the launcher before it spawned the daemon.
    for (const file of ["plugin.json", "dist/cli/squeal.mjs", "skills/squeal/SKILL.md"]) {
      expect(existsSync(join(copy, file)), file).toBe(true);
    }
    expect(existsSync(launcher)).toBe(true);
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    expect(cmdline).toContain(join(copy, "dist/cli/squeal.mjs"));
    const first = await e.hook("post-tool-batch", e.main);
    expect(first.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
    expect(first.text).toContain(`\`${launcher} checks\``);
    expect(first.text).toContain(join(copy, "skills/squeal/SKILL.md"));

    // `plugin install` replaces the plugin root in place: here it is gone for a while.
    rmSync(e.plugin, { recursive: true, force: true });
    expect(e.cliIdentity.path).toBe(join(copy, "dist/cli/squeal.mjs"));
    const broken = await e.edit(e.main, "math", MATH("-"), failing);
    expect((await e.ping(e.main))?.pid).toBe(pid);
    const status = JSON.parse(
      execFileSync(launcher, ["status", "--json"], {
        cwd: e.main,
        encoding: "utf8",
        env: { ...e.env },
      }),
    ) as StatusSnapshot;
    expect(status).toMatchObject({ available: true, revision: broken.revision });
    expect(status.knownFailures.map((f) => f.validity)).toEqual(["current"]);

    // The new root lands; the next tool batch delivers from the same daemon.
    copyPlugin("antigravity", e.plugin);
    const told = await e.hook("post-tool-batch", e.main);
    expect(told).toMatchObject({ code: 0, stderr: "" });
    expect(told.text).toContain(`FAIL  ${ADDS}\n      PASS -> FAIL`);
    expect(told.text).toContain(`${launcher} why '${ADDS}'`);
    expectAgrees(told.text, await e.status(e.main));
    expect((await e.ping(e.main))?.pid).toBe(pid);
  }, 240_000);
});

describe("Antigravity subagents (spec 024 D2)", () => {
  it("register, deliver and deny for their own conversation", async (ctx) => {
    const e = fixture(ctx, ANTIGRAVITY, { policy: { interrupt: { onRegression: true } } });
    await baseline(e);
    await registered(e);
    // The store exists now, so the subagent's own SessionStart registers it.
    const sub = { session_id: SUBAGENT };
    const start = await e.hook("session-start", e.main, sub);
    expect(start).toMatchObject({ code: 0, stderr: "" });
    expect(start.ms).toBeLessThan(HOOK_BUDGET_MS);
    expect(start.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
    const store = join(e.main, ".git/squeal/store.sqlite");
    expect(registeredSessions(store).sort()).toEqual([ANTIGRAVITY_SESSION, SUBAGENT].sort());

    // The main conversation hears the regression at its tool batch; the subagent's view is its own.
    await e.edit(e.main, "math", MATH("-"), failing);
    const main = await e.hook("post-tool-batch", e.main);
    expect(main.text).toContain(`FAIL  ${ADDS}\n      PASS -> FAIL`);
    expect(await e.hook("pre-tool-use", e.main)).toMatchObject({ code: 0, stdout: "" });
    const deny = await e.hook("pre-tool-use", e.main, sub);
    expect(deny).toMatchObject({ code: 0, stderr: "" });
    expect(deny.json?.decision).toBe("deny");
    expect(deny.text).toContain(`FAIL  ${ADDS}\n      PASS -> FAIL`);
    expect(deny.text).toContain("denied this write_file call, so the edit was not applied");
    expect(await e.hook("pre-tool-use", e.main, sub)).toMatchObject({ code: 0, stdout: "" });
    expect(await e.hook("post-tool-batch", e.main, sub)).toMatchObject({ code: 0, stdout: "" });

    // The recovery reaches each conversation once.
    await e.edit(e.main, "math", MATH(), quiet);
    for (const overrides of [{}, sub]) {
      const pass = await e.hook("post-tool-batch", e.main, overrides);
      expect(pass.text).toContain(`PASS  ${ADDS}\n      FAIL -> PASS`);
      expect((await e.hook("post-tool-batch", e.main, overrides)).stdout).toBe("");
    }
  }, 240_000);
});

describe("Antigravity run_command and squeal status (spec 024 D3, D6, 005 D8)", () => {
  it("denies an answered test command once and allows the rest with empty stdout", async (ctx) => {
    const e = fixture(ctx, ANTIGRAVITY, { policy: { testCommand: { denyWhenCurrent: true } } });
    await baseline(e);
    await registered(e);

    const ls = await runCommand(e, "ls src");
    expect(ls).toMatchObject({ code: 0, stdout: "", stderr: "" });
    const deny = await runCommand(e, "npx vitest run");
    expect(deny).toMatchObject({ code: 0, stderr: "" });
    expect(deny.ms).toBeLessThan(HOOK_BUDGET_MS);
    expect(deny.json?.decision).toBe("deny");
    expect(deny.text).toMatch(/^The command did not run\. Squeal holds current results/);
    expect(deny.text).toContain("for the 2 test files it runs");
    // Once per consumer: the same command now runs, and an allow is never `{}`.
    expect(await runCommand(e, "npx vitest run")).toMatchObject({ code: 0, stdout: "" });
  }, 240_000);

  it("names an unregistered conversation in squeal status, with the install command", async (ctx) => {
    const e = fixture(ctx, ANTIGRAVITY);
    await baseline(e);
    await registered(e);
    const other = "0d7c5b1e-3f0a-4b8e-9a51-2c6e8f4d7a90";
    const unregistered = await e.cli(e.main, ["status"], { ANTIGRAVITY_CONVERSATION_ID: other });
    expect(unregistered.code).toBe(0);
    expect(unregistered.stdout).toContain(
      `Antigravity: no Squeal consumer is registered for this conversation in this worktree (ANTIGRAVITY_CONVERSATION_ID ${other}).`,
    );
    expect(unregistered.stdout).toContain(ANTIGRAVITY_INSTALL_COMMAND);
    const own = await e.cli(e.main, ["status"], {
      ANTIGRAVITY_CONVERSATION_ID: ANTIGRAVITY_SESSION,
    });
    expect(own.code).toBe(0);
    expect(own.stdout).not.toContain("Antigravity:");
  }, 240_000);
});

const cli = antigravityCli(process.env);

describe.skipIf(cli === null)("antigravity plugin validate of the copy (spec 024 D1)", () => {
  it("counts one hooks file and one skill, with no error and no warning", () => {
    const copy = join(tempDir("squeal-e2e-antigravity-"), "plugin");
    copyPlugin("antigravity", copy);
    const out = execFileSync(cli ?? "", ["plugin", "validate", "--json", copy], {
      encoding: "utf8",
      timeout: 30_000,
      env: { PATH: process.env.PATH ?? "", HOME: tempDir("squeal-e2e-antigravity-home-") },
    });
    const report = JSON.parse(out) as {
      components?: { hooks?: number; skills?: number };
      findings?: { severity?: string }[];
    };
    expect(report.components).toMatchObject({ hooks: 1, skills: 1 });
    const serious = (report.findings ?? []).filter(
      (f) => f.severity === "error" || f.severity === "warning",
    );
    expect(serious).toEqual([]);
  }, 60_000);
});
