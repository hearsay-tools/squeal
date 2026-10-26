import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { shellWord } from "../../../src/core/text.js";
import { CODEX_SKILL_NOTE } from "../../../src/harness/codex/build.js";
import type { CodexHookName } from "../../../src/harness/codex/index.js";
import { primer } from "../../../src/harness/shared/primer.js";
import { liveSocket, runBundle, runtimeDir } from "../bundle-helpers.js";
import { type SquealRepo, squealRepo } from "../helpers.js";
import {
  A,
  B,
  type Built,
  buildVersions,
  type CodexMachine,
  codexMachine,
} from "./cache-fixture.js";
import { codexRecorded, sessionOf } from "./helpers.js";

/*
 * Spec 005 D3 as amended 2026-10-21 (row 005-73, `research/plugin-cache-cleanup.md`
 * Recommendation, tests 1 to 3): Codex's install of B deletes A's cache
 * directory, so a session that started on A keeps working only through
 * Squeal's own copy of A and the launcher in the plugin data directory.
 */

let built: Built;
beforeAll(async () => {
  built = await buildVersions([A, B]);
}, 120_000);
afterAll(() => built.cleanup());

let m: CodexMachine;
afterEach(() => m.cleanup());

const SESSION = sessionOf("exec", "session-start");
const skillOf = (data: string, version: string) =>
  join(data, "versions", version, "skills", "squeal", "SKILL.md");
const skillLine = (path: string) =>
  `Squeal's skill for this session, kept across plugin updates: \`${path}\`.`;

/** A repository whose daemon a live socket stands in for, and a hook runner for version `at`. */
async function session(at: string, env: Readonly<Record<string, string>> = {}) {
  const root = m.install(at);
  const r = squealRepo();
  r.apply(r.pass());
  const runtime = runtimeDir();
  await liveSocket(join(runtime, `squeal-${r.worktreeId}.sock`));
  const hookEnv = {
    XDG_RUNTIME_DIR: runtime,
    PLUGIN_ROOT: root,
    PLUGIN_DATA: m.data,
    HOME: m.home,
    PATH: m.path,
    ...env,
  };
  const hook = async (name: CodexHookName, fixture: string) => {
    const input = codexRecorded("exec", fixture, r.root, SESSION);
    const out = await runBundle(name, input, hookEnv, join(root, "dist"));
    expect(out, name).toMatchObject({ stderr: "", code: 0 });
    return (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
  };
  const shell = (command: string) =>
    m.shell(command, r.root, { XDG_RUNTIME_DIR: runtime, CODEX_SESSION_ID: "019a0000-0000" });
  return { r, root, hook, shell };
}

const fail = (r: SquealRepo) => r.apply(r.fail());
const launcherOf = (data: string) => join(data, "bin", "squeal");

describe("a Codex session keeps its version's copy and the launcher (005-73)", () => {
  it("test 1: SessionStart from A copies A and writes the launcher, which the primer and FAIL report name", async () => {
    m = codexMachine(built);
    const { r, root, hook } = await session(A);
    const start = await hook("session-start", "session-start");
    const copy = join(m.data, "versions", A);
    expect(existsSync(join(copy, "dist", "cli", "squeal.mjs"))).toBe(true);
    expect(existsSync(join(copy, "dist", "observe", "recorder.cjs"))).toBe(true);
    expect(readFileSync(skillOf(m.data, A), "utf8")).toBe(
      readFileSync(join(root, "skills", "squeal", "SKILL.md"), "utf8"),
    );
    const launcher = launcherOf(m.data);
    expect(readFileSync(launcher, "utf8")).toBe(
      readFileSync(join(root, "bin", "squeal-launcher"), "utf8"),
    );
    expect(statSync(launcher).mode & 0o111).toBe(0o111);

    const command = shellWord(launcher);
    expect(start.endsWith(`\n\n${skillLine(skillOf(m.data, A))}\n\n${primer(command)}`)).toBe(true);
    expect(start).not.toContain(m.cache);
    fail(r);
    const report = await hook("post-tool-use", "post-tool-use");
    expect(report.split("\n").at(-1)).toBe(
      `Full output: ${command} why 'src/math.test.ts > math > adds'`,
    );
    expect(report).not.toContain(m.cache);
  });

  it("test 2: after A's cache directory is deleted, the primer's CLI runs B and names A and B", async () => {
    m = codexMachine(built);
    const { r, hook, shell } = await session(A);
    const start = await hook("session-start", "session-start");
    const command = shellWord(launcherOf(m.data));
    expect(start).toContain(`\`${command} status --wait 60000`);
    m.install(B);
    m.remove(A);

    const version = shell(`${command} --version`);
    expect(version).toMatchObject({ status: 0, stdout: `${B}\n` });
    expect(version.stderr).toBe(
      `squeal: this command runs squeal ${B}; plugins: Codex ${B}; Codex sessions started on ${A} keep ${A} until they restart.\n`,
    );
    fail(r);
    const status = shell(`${command} status`);
    expect(status.stdout).toMatch(/^Revision: 2\nKnown failures: 1 \(1 test\)/);
    expect(status.stdout).toContain("math > adds");
    expect(status.stdout).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("test 3: after the same deletion, the skill the SessionStart text names reads, and names the launcher", async () => {
    m = codexMachine(built);
    const { root, hook } = await session(A);
    const start = await hook("session-start", "session-start");
    const named = /Squeal's skill for this session, kept across plugin updates: `([^`]+)`\./.exec(
      start,
    )?.[1];
    expect(named).toBe(skillOf(m.data, A));
    m.install(B);
    m.remove(A);
    expect(existsSync(join(root, "skills", "squeal", "SKILL.md"))).toBe(false);
    const skill = readFileSync(named ?? "", "utf8");
    expect(skill).toContain(`# Squeal\n\n${CODEX_SKILL_NOTE}\n`);
    expect(CODEX_SKILL_NOTE).toContain("`<plugin data>/bin/squeal`");
    expect(existsSync(join(named ?? "", "..", "references", "commands.md"))).toBe(true);
  });

  it("names the cache's CLI, and copies nothing, at a hook before any SessionStart of a new install", async () => {
    m = codexMachine(built);
    const { r, root, hook } = await session(A);
    fail(r);
    // The first boundary registers, so its text is the registration and the primer.
    const report = await hook("post-tool-use", "post-tool-use");
    const cli = `node --disable-warning=ExperimentalWarning ${root}/dist/cli/squeal.mjs`;
    expect(report).toContain(`\nFull output: ${cli} why 'src/math.test.ts > math > adds'\n`);
    expect(report.endsWith(`\n\n${primer(cli)}`)).toBe(true);
    expect(existsSync(m.data)).toBe(false);
  });

  it("starts the session from the cache, with no skill line, when the data directory cannot hold a copy", async () => {
    m = codexMachine(built);
    const blocked = join(m.dir, "blocked");
    writeFileSync(blocked, "a file where the data directory should be\n");
    const { root, hook } = await session(A, { PLUGIN_DATA: blocked });
    const start = await hook("session-start", "session-start");
    const cli = `node --disable-warning=ExperimentalWarning ${root}/dist/cli/squeal.mjs`;
    expect(start.endsWith(`\n\n${primer(cli)}`)).toBe(true);
    expect(start).not.toContain("Squeal's skill for this session");
  });
});
