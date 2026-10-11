import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claudeRunner, judgeArgs } from "../../evals/lib/index.mjs";

// Spec 006 D9 "Isolation": each judge call runs from a scratch directory with a scratch HOME,
// the parent's CLAUDE* and CEZ_* variables removed, and the scratch removed afterwards. A node
// script stands in for `claude` and reports what it was given; no model is called.

const root = mkdtempSync(join(tmpdir(), "squeal-judge-iso-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const base = mkdtempSync(join(root, "base-"));
const script = join(root, "fake-claude.mjs");
writeFileSync(
  script,
  `let input = "";
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ env: process.env, cwd: process.cwd(), argv: process.argv.slice(2), input }));
});
`,
);

const parent = {
  PATH: process.env.PATH,
  HOME: "/home/someone",
  CLAUDECODE: "1",
  CLAUDE_CODE_SESSION_ID: "abc",
  CLAUDE_EFFORT: "high",
  CEZ_TASK_ID: "t",
  ANTHROPIC_BASE_URL: "https://provider.invalid",
  ANTHROPIC_AUTH_TOKEN: "token-value-for-the-test",
  OPENAI_API_KEY: "not-for-the-judge",
  GITHUB_TOKEN: "not-for-the-judge-either",
  SSH_AUTH_SOCK: "/tmp/agent.sock",
};

describe("the judge's runner", () => {
  it("runs from a scratch directory with a scratch HOME and none of the parent's session variables", async () => {
    const run = claudeRunner({ base, parent, command: process.execPath, prefix: [script] });
    const args = judgeArgs({
      model: "claude-haiku-5-5",
      effort: "medium",
      system: "s",
      schema: {},
    });
    const r = await run({ args, input: "[1] final message:\nDone." });
    expect(r.status).toBe(0);
    const seen = JSON.parse(r.stdout) as {
      env: Record<string, string>;
      cwd: string;
      argv: string[];
      input: string;
    };
    expect(seen.argv).toEqual(args);
    expect(seen.input).toBe("[1] final message:\nDone.");
    expect(seen.cwd.startsWith(join(base, "squeal-judge-"))).toBe(true);
    expect(seen.env.HOME?.startsWith(join(base, "squeal-judge-"))).toBe(true);
    expect(seen.env.TMPDIR?.startsWith(join(base, "squeal-judge-"))).toBe(true);
    expect(Object.keys(seen.env).filter((k) => /^(CLAUDE|CEZ_)/.test(k))).toEqual([]);
    expect(seen.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(seen.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(seen.env).not.toHaveProperty("SSH_AUTH_SOCK");
    // Claude Code's own provider variables are how the CLI authenticates (D9: never --bare).
    expect(seen.env.ANTHROPIC_AUTH_TOKEN).toBe(parent.ANTHROPIC_AUTH_TOKEN);
    expect(readdirSync(base)).toEqual([]);
  });

  it("removes the scratch when the command cannot start", async () => {
    const run = claudeRunner({ base, parent, command: join(root, "no-such-command") });
    const r = await run({ args: ["--version"] });
    expect(r.status).toBeNull();
    expect(readdirSync(base)).toEqual([]);
  });

  it("refuses to start claude under Vitest: the suite never calls a model", () => {
    const run = claudeRunner({ base, parent: { ...parent, VITEST: "true" } });
    expect(() => run({ args: ["--version"] })).toThrow(/never calls a model/);
    expect(readdirSync(base)).toEqual([]);
  });
});
