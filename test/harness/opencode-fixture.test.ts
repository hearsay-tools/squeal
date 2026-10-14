import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type OpenCodeMode,
  type OpenCodeRun,
  opencodeUnavailable,
  runOpenCode,
  textOf,
} from "../helpers/opencode.js";
import { piBase } from "../helpers/pi.js";

// Spec 008 Testing: the real OpenCode 1.18.35 runs with the scripted provider, no credentials and
// no network, and a test asserts what reached each model request.

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI)
  throw new Error(`OpenCode fixture unavailable on CI: ${unavailable}`);

const runs: OpenCodeRun[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("runOpenCode's protected environment", () => {
  it.each([
    "HOME",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_DISABLE_MODELS_FETCH",
    "OPENCODE_DISABLE_AUTOUPDATE",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_TEST_HOME",
    "OPENCODE_DB",
  ])("an override of %s throws without starting OpenCode", async (key) => {
    const target = mkdtempSync(join(piBase(), "squeal-opencode-override-"));
    dirs.push(target);
    const run = runOpenCode({ mode: "run", prompt: "hi", plan: [], env: { [key]: target } });
    await expect(run).rejects.toThrow(key);
    expect(readdirSync(target)).toEqual([]);
  });
});

describe.skipIf(unavailable !== undefined)("the scripted-provider OpenCode fixture", () => {
  it.each<OpenCodeMode>(["run", "serve"])(
    "%s: a scripted write's result reaches the next model request",
    { timeout: 90_000 },
    async (mode) => {
      const run = await runOpenCode({
        mode,
        prompt: "write out.txt",
        plan: [
          { tools: [{ name: "write", arguments: { filePath: "out.txt", content: "written\n" } }] },
          { text: "done" },
        ],
      });
      runs.push(run);

      expect(run.exitCode, run.stderr).toBe(mode === "run" ? 0 : null);
      expect(readFileSync(join(run.cwd, "out.txt"), "utf8")).toBe("written\n");
      expect(run.sessionID).toMatch(/^ses_/);
      expect(run.requests.map((request) => request.n)).toEqual([0, 1]);
      const [first, second] = run.requests;
      expect(first?.tools).toContain("write");
      expect(first?.messages.map((message) => message.role)).toEqual(["system", "user"]);
      expect(textOf(first?.messages[1])).toContain("write out.txt");

      const [call, result] = second?.messages.slice(-2) ?? [];
      expect(call?.tool_calls?.[0]).toMatchObject({ id: "call_0_0", function: { name: "write" } });
      expect(result).toMatchObject({ role: "tool", tool_call_id: "call_0_0" });
      expect(textOf(result)).toContain("Wrote file successfully");

      if (mode === "run") {
        const tool = run.events.find((event) => event.type === "tool_use");
        expect(tool?.part).toMatchObject({ tool: "write", state: { status: "completed" } });
        expect(run.events.at(-1)?.type).toBe("step_finish");
      }
    },
  );
});
