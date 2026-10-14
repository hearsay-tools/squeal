import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inRepository,
  type PiMode,
  type PiRun,
  piBase,
  piUnavailable,
  runPi,
  textOf,
} from "../helpers/pi.js";

// Spec 009 Testing: the real Pi 1.0.4 runs with the scripted fake provider, no credentials and
// no network, and a test asserts what reached each model request.

const unavailable = piUnavailable();
if (unavailable && process.env.CI) throw new Error(`Pi fixture unavailable on CI: ${unavailable}`);

const runs: PiRun[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MARK = "ANCESTOR-REPOSITORY-MARK";

/** A repository outside any other, holding `files` by relative path. */
function repository(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(piBase(), "squeal-pi-repo-"));
  dirs.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git/HEAD"), "ref: refs/heads/main\n");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const outside = (path: string, root: string) => relative(root, path).startsWith("..");

// Review wave 0 S1: the isolation variables are not the caller's to set.
describe("runPi's protected environment", () => {
  it.each([
    "HOME",
    "TMPDIR",
    "PI_CODING_AGENT_DIR",
    "PI_OFFLINE",
    "PI_FIXTURE_PLAN",
    "PI_FIXTURE_LOG",
  ])("an override of %s throws without starting Pi", async (key) => {
    const target = mkdtempSync(join(piBase(), "squeal-pi-override-"));
    dirs.push(target);
    const run = runPi({ mode: "print", prompts: ["hi"], plan: [], env: { [key]: target } });
    await expect(run).rejects.toThrow(key);
    expect(readdirSync(target)).toEqual([]);
  });
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

describe.skipIf(unavailable !== undefined)("the Pi fixture outside repositories", () => {
  it("a TMPDIR inside a repository puts Pi's project outside it", { timeout: 60_000 }, async () => {
    const root = repository({ "AGENTS.md": MARK, "tmp/.keep": "" });
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = join(root, "tmp");
    let run: PiRun;
    try {
      run = await runPi({ mode: "print", prompts: ["hi"], plan: [{ text: "done" }] });
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
    runs.push(run);

    expect(run.exitCode, run.stderr).toBe(0);
    for (const path of [run.dir, run.cwd, run.agentDir]) {
      expect(outside(path, root), path).toBe(true);
      expect(inRepository(path), path).toBe(false);
    }
    expect(readdirSync(join(root, "tmp"))).toEqual([".keep"]);
  });

  it.each<PiMode>(["print", "json", "rpc"])(
    "%s: a cwd inside a repository reads none of its context, skills or .pi",
    { timeout: 60_000 },
    async (mode) => {
      // Pi reads one context file per directory, so `CLAUDE.md` and `AGENTS.md` sit apart.
      // Without the flags only the two context files leak: an untrusted project's skills and
      // `.pi` are already skipped outside the TUI; `--no-skills` and `--no-approve` keep it so.
      const root = repository({
        "CLAUDE.md": `${MARK} claude`,
        "mid/AGENTS.md": `${MARK} agents`,
        ".agents/skills/x/SKILL.md": `---\nname: x\ndescription: ${MARK} skill\n---\nBody.\n`,
        ".pi/settings.json": JSON.stringify({ skills: ["../settings-skills"] }),
        ".pi/APPEND_SYSTEM.md": `${MARK} append`,
        "settings-skills/y/SKILL.md": `---\nname: y\ndescription: ${MARK} settings\n---\nBody.\n`,
        "mid/proj/.keep": "",
      });
      const run = await runPi({
        mode,
        cwd: join(root, "mid/proj"),
        prompts: ["hi"],
        plan: [{ text: "done" }],
      });
      runs.push(run);

      expect(run.exitCode, run.stderr).toBe(0);
      expect(run.requests).toHaveLength(1);
      expect(JSON.stringify(run.requests)).not.toContain(MARK);
    },
  );
});
