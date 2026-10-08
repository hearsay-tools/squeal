import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codexCommand } from "../../../src/harness/codex/command.js";
import { type CodexHookName, runCodexHook } from "../../../src/harness/codex/index.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { primer } from "../../../src/harness/shared/primer.js";
import { liveSocket, runBundle, runtimeDir } from "../bundle-helpers.js";
import { type SquealRepo, SUBTRACTS, squealRepo } from "../helpers.js";
import { buildCodexBundles, codexRecorded, sessionOf } from "./helpers.js";

/*
 * Spec 002 D1 as amended, `lessons.md` defect 4: `bin/` is not on a Codex
 * agent's PATH, so every text that tells it to run Squeal names the installed
 * CLI by its path.
 */

describe("codexCommand", () => {
  it("names the CLI under PLUGIN_ROOT, quoted for a shell", () => {
    const env = { PLUGIN_ROOT: "/home/u/.codex/plugins/cache/squeal/squeal/0.1.25" };
    expect(codexCommand(env, "/elsewhere/dist/cli/squeal.mjs")).toBe(
      'node --disable-warning=ExperimentalWarning "/home/u/.codex/plugins/cache/squeal/squeal/0.1.25/dist/cli/squeal.mjs"',
    );
  });

  it("names the running bundle's sibling CLI without PLUGIN_ROOT, as for launcher hooks", () => {
    expect(codexCommand({}, "/p/dist/cli/squeal.mjs")).toBe(
      'node --disable-warning=ExperimentalWarning "/p/dist/cli/squeal.mjs"',
    );
    expect(codexCommand({ PLUGIN_ROOT: "" }, "/p/dist/cli/squeal.mjs")).toBe(
      'node --disable-warning=ExperimentalWarning "/p/dist/cli/squeal.mjs"',
    );
  });

  it("single-quotes a path the shell would expand inside double quotes", () => {
    expect(codexCommand({ PLUGIN_ROOT: "/a $b" }, "/x")).toBe(
      "node --disable-warning=ExperimentalWarning '/a $b/dist/cli/squeal.mjs'",
    );
  });
});

/** Every text a Codex hook says, named by `deps.command`; none names a bare `squeal`. */
describe("Codex hook texts name the command they are given", () => {
  const command = 'node "/opt/codex/plugins/squeal/dist/cli/squeal.mjs"';
  /** Every header's checkpoint line without a checkpoint at the current revision (defect 27). */
  const checkpoint = `\`${command} run --all\` requests one`;
  const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive", command };
  const IN_SESSION = sessionOf("exec", "session-start");
  const text = async (r: SquealRepo, name: CodexHookName, fixture: string, over: object = {}) => {
    const out = await runCodexHook(
      name,
      codexRecorded("exec", fixture, r.root, { ...IN_SESSION, ...over }),
      deps,
    );
    const output = JSON.parse(out.stdout) as {
      hookSpecificOutput?: { additionalContext?: string; permissionDecisionReason?: string };
      reason?: string;
    };
    const said =
      output.hookSpecificOutput?.additionalContext ??
      output.hookSpecificOutput?.permissionDecisionReason ??
      output.reason ??
      "";
    expect(said).not.toMatch(/`squeal |squeal (why|status|run)/);
    return said;
  };

  it("in the primer of SessionStart, SubagentStart and a compacted session", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    const start = await text(r, "session-start", "session-start");
    expect(start.endsWith(`\n\n${primer(command)}`)).toBe(true);
    expect(start).toContain(checkpoint);
    expect(start).toContain(`Full output: ${command} why "src/math.test.ts > math > adds"`);
    const sub = await text(r, "subagent-start", "subagent-start");
    expect(sub.endsWith(`\n\n${primer(command)}`)).toBe(true);
    expect(await text(r, "session-start", "session-start", { source: "compact" })).toBe(
      primer(command),
    );
  });

  it("in a deny, a FAIL report and a Stop block", async () => {
    const r = squealRepo();
    r.apply(r.pass(), r.pass(SUBTRACTS));
    r.policy({ stop: { requireFullSuite: true } });
    await text(r, "session-start", "session-start");
    const why = (name: string) => `Full output: ${command} why "src/math.test.ts > math > ${name}"`;
    r.apply(r.fail(), r.pass(SUBTRACTS));
    const delivered = await text(r, "post-tool-use", "post-tool-use");
    expect(delivered.split("\n").at(-1)).toBe(why("adds"));
    expect(delivered).toContain(checkpoint);
    r.apply(r.fail(), r.fail(SUBTRACTS));
    const denied = await text(r, "pre-tool-use", "pre-tool-use-apply-patch");
    expect(denied).toContain(`\n${why("subtracts")}\n`);
    expect(denied).toContain(checkpoint);
    const stop = await text(r, "stop", "stop");
    expect(stop).toContain(`\`${command} run --all\` starts one.`);
    expect(stop).toContain(`SQUEAL · status at revision`);
    expect(stop).toContain(checkpoint);
  });
});

let dist = "";
let cleanup = () => {};
let scratch = "";
beforeAll(async () => {
  ({ dir: dist, cleanup } = await buildCodexBundles());
  scratch = mkdtempSync("/tmp/sq-cmd-");
}, 60_000);
afterAll(() => {
  cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

/** A plugin root whose `dist` is the built bundles, as Codex's cache holds one. */
function pluginRoot(): string {
  const root = join(scratch, "plugin root");
  mkdirSync(root, { recursive: true });
  symlinkSync(dist, join(root, "dist"));
  return root;
}

/** A PATH with `node` and the system tools on it, and no `squeal`. */
function pathWithoutSqueal(): string {
  const bin = join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, join(bin, "node"));
  return `${bin}:/usr/bin:/bin`;
}

describe("bundled Codex hooks name a CLI the agent's shell runs", () => {
  it("in the SessionStart primer and a FAIL report's last line, with no squeal on PATH", async () => {
    const root = pluginRoot();
    const PATH = pathWithoutSqueal();
    const r = squealRepo();
    r.apply(r.pass());
    const env = { XDG_RUNTIME_DIR: runtimeDir(), PLUGIN_ROOT: root };
    await liveSocket(join(env.XDG_RUNTIME_DIR, `squeal-${r.worktreeId}.sock`));
    const context = async (name: CodexHookName, fixture: string) => {
      const input = codexRecorded("exec", fixture, r.root, sessionOf("exec", "session-start"));
      const out = await runBundle(name, input, { ...env, PATH }, dist);
      expect(out, name).toMatchObject({ stderr: "", code: 0 });
      return (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext;
    };
    const shell = (command: string) =>
      spawnSync("bash", ["-c", command], {
        cwd: r.root,
        env: { PATH, HOME: process.env.HOME ?? "", XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR },
        encoding: "utf8",
      });
    expect(shell("command -v squeal").status).not.toBe(0);
    const command = `node --disable-warning=ExperimentalWarning "${root}/dist/cli/squeal.mjs"`;

    const start = await context("session-start", "session-start");
    expect(start.endsWith(`\n\n${primer(command)}`)).toBe(true);
    expect(start).not.toMatch(/`squeal /);
    const wait = /`([^`]+) status --wait 60000`/.exec(start)?.[1];
    expect(wait).toBe(command);
    const status = shell(`${wait} status`);
    expect(status.stderr).toBe("");
    expect(status.status).toBe(0);
    expect(status.stdout).toMatch(/^Revision: 1\nKnown failures: 0\n/);

    r.apply(r.fail());
    const report = await context("post-tool-use", "post-tool-use");
    expect(report).toContain("PASS -> FAIL");
    const last = report.split("\n").at(-1) ?? "";
    expect(last).toBe(`Full output: ${command} why "src/math.test.ts > math > adds"`);
    const why = shell(last.slice("Full output: ".length));
    expect(why.stderr).toBe("");
    expect(why.status).toBe(0);
    expect(why.stdout).toContain("math > adds");
  });

  it("names the bundle's sibling CLI when the hook has no PLUGIN_ROOT", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const env = { XDG_RUNTIME_DIR: runtimeDir() };
    await liveSocket(join(env.XDG_RUNTIME_DIR, `squeal-${r.worktreeId}.sock`));
    const input = codexRecorded("exec", "session-start", r.root);
    const out = await runBundle("session-start", input, env, dist);
    const text = (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect(
      text.endsWith(
        `\n\n${primer(`node --disable-warning=ExperimentalWarning "${join(dist, "cli/squeal.mjs")}"`)}`,
      ),
    ).toBe(true);
  });
});
