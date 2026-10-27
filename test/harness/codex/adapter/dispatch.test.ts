import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentFile, pinFile } from "../../../../src/harness/codex/adapter/layout.js";
import { publishRuntime } from "../../../../src/harness/codex/adapter/store.js";
import { tempDir } from "../../../store/helpers.js";
import { outsideGit } from "../../bundle-helpers.js";
import { buildAdapter, fixedPlugin, type Ran, runAdapter, runtimeTree, write } from "./fixture.js";

/*
 * Row 002-29 (spec 002 D9): the fixed plugin's adapter, run as Codex runs a
 * hook, keeps each session on the runtime it first selected. A session that
 * started on A stays on A after B becomes current; a new session selects B.
 */

const A = "0.1.900";
const B = "0.1.901";

let scratch = "";
let adapter = "";
beforeAll(async () => {
  scratch = mkdtempSync("/tmp/sq-adapter-");
  adapter = await buildAdapter(scratch);
}, 60_000);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A fixed plugin with seed A, an empty data directory and a repository using Squeal. */
function machine(seed = A) {
  const dir = tempDir("sq-adapter-machine-");
  const plugin = fixedPlugin(join(dir, "plugin"), seed);
  const data = join(dir, "data");
  const repo = join(dir, "repo");
  write(join(repo, "squeal.config.json"), "{}\n");
  const env = { PLUGIN_ROOT: plugin, PLUGIN_DATA: data };
  const hook = async (name: string, session: string, cwd = repo): Promise<Ran> => {
    const out = await runAdapter(adapter, name, { session_id: session, cwd }, env);
    expect(out, `${name} ${session}`).toMatchObject({ code: 0, stderr: "" });
    return JSON.parse(out.stdout) as Ran;
  };
  return { dir, plugin, data, repo, env, hook };
}

const current = (data: string) => JSON.parse(readFileSync(currentFile(data), "utf8")) as unknown;

describe("the adapter keeps a session on its first runtime (002-29)", () => {
  it("an A session stays on A after B becomes current, while a new session selects B", async () => {
    const m = machine();
    const first = await m.hook("session-start", "s-a");
    expect(first).toEqual({
      version: A,
      name: "session-start",
      root: join(m.data, "versions", A),
      data: m.data,
      adapter: m.plugin,
      session: "s-a",
    });
    const b = runtimeTree(join(m.dir, "staged-b"), B);
    expect(publishRuntime({ sourceRoot: b, data: m.data, select: true })).toEqual({
      root: join(m.data, "versions", B),
      version: B,
    });
    expect(current(m.data)).toEqual({ schema: 1, version: B });
    expect((await m.hook("post-tool-use", "s-a")).version).toBe(A);
    expect((await m.hook("session-start", "s-b")).version).toBe(B);
    expect((await m.hook("stop", "s-a")).version).toBe(A);
    expect((await m.hook("user-prompt-submit", "s-b")).version).toBe(B);
  });

  it("first use publishes the seed, selects it and pins the session from any hook, not only SessionStart", async () => {
    const m = machine();
    expect(existsSync(m.data)).toBe(false);
    const ran = await m.hook("user-prompt-submit", "s-1");
    expect(ran).toMatchObject({ version: A, root: join(m.data, "versions", A) });
    expect(current(m.data)).toEqual({ schema: 1, version: A });
    expect(JSON.parse(readFileSync(pinFile(m.data, "s-1"), "utf8"))).toEqual({
      schema: 1,
      sessionId: "s-1",
      version: A,
    });
    expect(readdirSync(join(m.data, "versions"))).toEqual([A]);
    // The seed's tree, whole, runtime.json included; the fixed plugin is unchanged.
    expect(readFileSync(join(m.data, "versions", A, "runtime.json"), "utf8")).toBe(
      readFileSync(join(m.plugin, "seed", "runtime.json"), "utf8"),
    );
  });

  it("SessionEnd releases the pin after dispatch; resume and other hooks keep it", async () => {
    const m = machine();
    await m.hook("session-start", "s-1");
    publishRuntime({ sourceRoot: runtimeTree(join(m.dir, "b"), B), data: m.data, select: true });
    for (const name of ["session-start", "subagent-start", "interrupt", "subagent-stop"]) {
      expect((await m.hook(name, "s-1")).version, name).toBe(A);
    }
    expect((await m.hook("session-end", "s-1")).version).toBe(A);
    expect(existsSync(pinFile(m.data, "s-1"))).toBe(false);
    // A later contact of that id is a first contact again.
    expect((await m.hook("session-start", "s-1")).version).toBe(B);
  });

  it("first-hook race: concurrent first hooks of one session, beside a publication, share one pin", async () => {
    const m = machine();
    const b = runtimeTree(join(m.dir, "b"), B);
    const hooks = ["session-start", "user-prompt-submit", "post-tool-use", "pre-tool-use"].flatMap(
      (name) => [m.hook(name, "s-race"), m.hook(name, "s-race")],
    );
    // About a Node start later, while the first hooks select and pin.
    await new Promise((up) => setTimeout(up, 40));
    publishRuntime({ sourceRoot: b, data: m.data, select: true });
    const versions = new Set((await Promise.all(hooks)).map((r) => r.version));
    expect(versions.size).toBe(1);
    const pin = JSON.parse(readFileSync(pinFile(m.data, "s-race"), "utf8")) as { version: string };
    expect(versions).toEqual(new Set([pin.version]));
    expect(readdirSync(join(m.data, "runtime", "sessions"))).toHaveLength(1);
    // B, and A when a hook published the seed first; no staging leftovers.
    expect(readdirSync(join(m.data, "versions"))).toContain(B);
    expect(readdirSync(join(m.data, "versions")).every((v) => v === A || v === B)).toBe(true);
  });

  it("concurrent first contacts of new sessions publish the seed once", async () => {
    const m = machine();
    const ran = await Promise.all(
      Array.from({ length: 6 }, (_, i) => m.hook("session-start", `s-${i}`)),
    );
    expect(new Set(ran.map((r) => r.version))).toEqual(new Set([A]));
    expect(readdirSync(join(m.data, "versions"))).toEqual([A]);
    expect(readdirSync(join(m.data, "runtime", "sessions"))).toHaveLength(6);
  });

  it("a session in a repository that does not use Squeal runs the current runtime without a pin", async () => {
    const m = machine();
    const elsewhere = outsideGit();
    expect((await m.hook("session-start", "s-plain", elsewhere)).version).toBe(A);
    expect(existsSync(pinFile(m.data, "s-plain"))).toBe(false);
  });
});

describe("a missing pinned runtime (002-29)", () => {
  it("is a diagnostic at the hooks that carry context, never another version", async () => {
    const m = machine();
    await m.hook("session-start", "s-1");
    publishRuntime({ sourceRoot: runtimeTree(join(m.dir, "b"), B), data: m.data, select: true });
    rmSync(join(m.data, "versions", A), { recursive: true });
    for (const [name, event] of [
      ["session-start", "SessionStart"],
      ["user-prompt-submit", "UserPromptSubmit"],
      ["subagent-start", "SubagentStart"],
    ] as const) {
      const out = await runAdapter(adapter, name, { session_id: "s-1", cwd: m.repo }, m.env);
      expect(out).toMatchObject({ code: 0, stderr: "" });
      const context = (
        JSON.parse(out.stdout) as {
          hookSpecificOutput: { hookEventName: string; additionalContext: string };
        }
      ).hookSpecificOutput;
      expect(context.hookEventName).toBe(event);
      expect(context.additionalContext).toContain("SQUEAL · validation unavailable");
      expect(context.additionalContext).toContain(`Squeal runtime ${A}`);
      expect(context.additionalContext).toContain("Start a new Codex session");
      expect(context.additionalContext).not.toContain(B);
    }
    for (const name of ["post-tool-use", "pre-tool-use", "stop", "session-end"]) {
      const out = await runAdapter(adapter, name, { session_id: "s-1", cwd: m.repo }, m.env);
      expect(out, name).toMatchObject({ code: 0, stdout: "", stderr: "" });
    }
    // The pin stays: a restored A serves the session again, and B was never run for it.
    expect(existsSync(pinFile(m.data, "s-1"))).toBe(true);
    // A new session is unaffected.
    expect((await m.hook("session-start", "s-2")).version).toBe(B);
  });

  it("is silent in a repository that does not use Squeal", async () => {
    const m = machine();
    const elsewhere = outsideGit();
    rmSync(join(m.plugin, "seed", "dist", "runtime.mjs"));
    const out = await runAdapter(
      adapter,
      "session-start",
      { session_id: "s-1", cwd: elsewhere },
      m.env,
    );
    expect(out).toMatchObject({ code: 0, stdout: "", stderr: "" });
  });

  it("an unusable seed with no runtime installed says so, and starts nothing", async () => {
    const m = machine();
    rmSync(join(m.plugin, "seed", "dist", "runtime.mjs"));
    const out = await runAdapter(
      adapter,
      "session-start",
      { session_id: "s-1", cwd: m.repo },
      m.env,
    );
    expect(out).toMatchObject({ code: 0, stderr: "" });
    expect(out.stdout).toContain("No usable Squeal runtime");
    expect(out.stdout).toContain("dist/runtime.mjs is missing");
    expect(existsSync(join(m.data, "versions"))).toBe(false);
    expect(existsSync(pinFile(m.data, "s-1"))).toBe(false);
  });

  it("an unknown hook name, or no PLUGIN_DATA, runs nothing", async () => {
    const m = machine();
    const input = { session_id: "s-1", cwd: m.repo };
    expect(await runAdapter(adapter, "../stop", input, m.env)).toMatchObject({
      stdout: "",
      code: 0,
    });
    expect(await runAdapter(adapter, "stop", input, { PLUGIN_ROOT: m.plugin })).toMatchObject({
      stdout: "",
      code: 0,
    });
    expect(existsSync(m.data)).toBe(false);
  });
});
