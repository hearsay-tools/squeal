import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type OpenCodeMode, opencodeUnavailable, textOf } from "../helpers/opencode.js";
import { buildOpencodeBundles } from "./opencode/helpers.js";
import { bridgesRunning, type SquealRun, squealOpenCode } from "./opencode/real.js";

/*
 * Spec 008 goals 1, 3, 5, 6 and 9 with the real OpenCode 1.18.35, the
 * scripted provider and the built plugin, under `run` and `serve`: a
 * regression reaches the next model request in a tool result, an edit over
 * an undelivered one is blocked once and re-issued, the primer is in every
 * request, a child's included, and `run` exits with no bridge left running.
 */

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI)
  throw new Error(`OpenCode fixture unavailable on CI: ${unavailable}`);

const MODES: OpenCodeMode[] = ["run", "serve"];
const PRIMER = "Squeal runs this repository's";

let built = { dir: "", cleanup: () => {} };
const runs: SquealRun[] = [];
beforeAll(async () => {
  built = await buildOpencodeBundles();
}, 120_000);
afterAll(() => built.cleanup());
afterEach(() => {
  for (const { run } of runs.splice(0)) run.cleanup();
});

const squeal = async (options: Omit<Parameters<typeof squealOpenCode>[0], "dist">) => {
  const result = await squealOpenCode({ dist: built.dir, timeoutMs: 120_000, ...options });
  runs.push(result);
  return result;
};

/** The text of a request's system messages. */
const system = (request: { messages: { role: string; content?: unknown }[] } | undefined) =>
  (request?.messages ?? [])
    .filter((m) => m.role === "system")
    .map((m) => textOf(m))
    .join("\n");

/** The text of every message of a request. */
const all = (request: { messages: { content?: unknown }[] } | undefined) =>
  (request?.messages ?? []).map((m) => textOf(m)).join("\n");

describe.skipIf(unavailable !== undefined)("the Squeal plugin in OpenCode", () => {
  it.each(MODES)(
    "%s: a regression reaches the next request in the tool's result; the primer is in every request",
    { timeout: 180_000 },
    async (mode) => {
      const { run } = await squeal({
        mode,
        prompt: "list the files",
        plan: [
          // The model answers after the regression landed.
          {
            tools: [{ name: "bash", arguments: { command: "ls", description: "list" } }],
            delayMs: 1_500,
          },
          { text: "done" },
        ],
        onRegistered: (r) => r.apply(r.fail()),
      });
      expect(run.exitCode, run.stderr).toBe(mode === "run" ? 0 : null);
      const [first, second] = run.requests;
      expect(run.requests).toHaveLength(2);
      for (const request of run.requests) expect(system(request)).toContain(PRIMER);
      expect(textOf(first?.messages.at(-1))).toMatch(/SQUEAL · registered at revision \d+/);
      const result = second?.messages.at(-1);
      expect(result?.role).toBe("tool");
      expect(textOf(result)).toMatch(/\n\nSQUEAL · .*\n[\s\S]*PASS -> FAIL/);
      if (mode === "run") {
        // `run` exits after its turn; dispose killed the idle wait it armed.
        await expect.poll(() => bridgesRunning(built.dir, "wait.mjs")).toEqual([]);
      }
    },
  );

  it.each(MODES)(
    "%s: an edit over an undelivered regression is blocked once, then re-issued",
    { timeout: 180_000 },
    async (mode) => {
      const write = { name: "write", arguments: { filePath: "out.txt", content: "written\n" } };
      const { run } = await squeal({
        mode,
        prompt: "write out.txt",
        plan: [{ tools: [write], delayMs: 1_500 }, { tools: [write] }, { text: "done" }],
        onRegistered: (r) => r.apply(r.fail()),
      });
      expect(run.exitCode, run.stderr).toBe(mode === "run" ? 0 : null);
      expect(run.requests).toHaveLength(3);
      const blocked = textOf(run.requests[1]?.messages.at(-1));
      expect(blocked).toContain("PASS -> FAIL");
      expect(blocked).toContain("denied this write call, so the edit was not applied");
      const written = textOf(run.requests[2]?.messages.at(-1));
      expect(written).toContain("Wrote file successfully");
      expect(written).not.toContain("SQUEAL");
      expect(readFileSync(join(run.cwd, "out.txt"), "utf8")).toBe("written\n");
    },
  );

  it("run: a child session gets the primer and its own registration", {
    timeout: 180_000,
  }, async () => {
    const { run, r } = await squeal({
      mode: "run",
      prompt: "delegate",
      plan: [
        {
          tools: [
            {
              name: "task",
              arguments: { description: "child", prompt: "child work", subagent_type: "general" },
            },
          ],
        },
        { text: "child done" },
        { text: "done" },
      ],
    });
    expect(run.exitCode, run.stderr).toBe(0);
    const child = run.requests.find((request) => all(request).includes("child work"));
    expect(child, JSON.stringify(run.requests.map((q) => all(q).slice(0, 200)))).toBeDefined();
    expect(system(child)).toContain(PRIMER);
    expect(all(child)).toMatch(/SQUEAL · registered at revision \d+/);
    // The child's consumer ended at its idle; the root's at dispose.
    expect(r.store.consumers.list(r.worktreeId)).toEqual([]);
    expect(existsSync(run.cwd)).toBe(true);
  });
});
