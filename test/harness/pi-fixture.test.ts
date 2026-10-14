import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type PiMode, type PiRun, piUnavailable, runPi, textOf } from "../helpers/pi.js";

// Spec 009 Testing: the real Pi 1.0.4 runs with the scripted fake provider, no credentials and
// no network, and a test asserts what reached each model request.

const unavailable = piUnavailable();
if (unavailable && process.env.CI) throw new Error(`Pi fixture unavailable on CI: ${unavailable}`);

const runs: PiRun[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});

describe.skipIf(unavailable !== undefined)("the fake-provider Pi fixture", () => {
  it.each<PiMode>(["print", "json", "rpc"])(
    "%s: a scripted write's result reaches the next model request",
    { timeout: 60_000 },
    async (mode) => {
      const run = await runPi({
        mode,
        prompts: ["write out.txt"],
        plan: [
          { tools: [{ name: "write", arguments: { path: "out.txt", content: "written\n" } }] },
          { text: "done" },
        ],
      });
      runs.push(run);

      expect(run.exitCode, run.stderr).toBe(0);
      expect(readFileSync(join(run.cwd, "out.txt"), "utf8")).toBe("written\n");
      expect(run.requests.map((request) => request.n)).toEqual([0, 1]);
      const [first, second] = run.requests;
      // Pi 1.0.4 carries the system prompt as the first message; the fixture records its text.
      expect(first?.messages.map((message) => message.role)).toEqual(["system", "user"]);
      expect(textOf(first?.messages[1])).toBe("write out.txt");
      expect(first?.systemPrompt).toContain("write");

      const result = second?.messages.at(-1);
      expect(result).toMatchObject({
        role: "toolResult",
        toolName: "write",
        toolCallId: "call_0_0",
      });
      expect(result?.isError).toBe(false);
      expect(textOf(result)).toContain("out.txt");

      if (mode === "print") expect(run.stdout.trim()).toBe("done");
      else expect(run.events.map((event) => event.type)).toContain("agent_end");
      if (mode === "rpc") expect(run.events.map((event) => event.type)).toContain("agent_settled");
    },
  );
});
