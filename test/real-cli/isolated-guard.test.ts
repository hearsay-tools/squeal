import { describe, expect, it } from "vitest";
import { secretsOf } from "../../evals/lib/index.mjs";
import { guard, type Spawn } from "./isolated.js";

/*
 * The real-CLI process guard (005-42 S1), under the normal config: synthetic
 * credentials, and `guard` only, so nothing is spawned and no home is read.
 */

const KEY = "sk-ant-synthetic-0123456789abcdefghijklmnopqrstuvwxyz";
const SECRETS = secretsOf({
  ANTHROPIC_API_KEY: KEY,
  OPENAI_BASE_URL: "https://proxy.example.test/v1",
});

const root = "/home/squeal-e2e/runs/guard-test";
const spawn = (over: Partial<Spawn> = {}): Spawn => ({
  root,
  cmd: "codex",
  args: ["exec", "--skip-git-repo-check"],
  cwd: `${root}/repo`,
  env: Object.fromEntries(
    ["HOME", "TMPDIR", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "XDG_RUNTIME_DIR"].map((name) => [
      name,
      `${root}/${name.toLowerCase()}`,
    ]),
  ),
  path: [`${root}/bin`],
  preserve: ["ANTHROPIC_API_KEY"],
  ...over,
});

describe("guard", () => {
  it("passes a case that keeps credentials to preserved names", () => {
    expect(() => guard(spawn(), SECRETS)).not.toThrow();
  });

  it("refuses a credential in a scratch variable", () => {
    expect(() => guard(spawn({ env: { ...spawn().env, LANG: KEY } }), SECRETS)).toThrow(
      "refused: LANG holds a credential",
    );
  });

  it("refuses a credential in an argument, whole or embedded", () => {
    expect(() => guard(spawn({ args: ["exec", KEY] }), SECRETS)).toThrow(
      "refused: argument 2 holds a credential",
    );
    expect(() => guard(spawn({ args: [`--header=x-api-key: ${KEY}`] }), SECRETS)).toThrow(
      "refused: argument 1 holds a credential",
    );
    expect(() =>
      guard(spawn({ args: ["-c", "base_url=https://proxy.example.test/v1"] }), SECRETS),
    ).toThrow("refused: argument 2 holds a credential");
  });

  it("refuses a credential in the command", () => {
    expect(() => guard(spawn({ cmd: `ANTHROPIC_API_KEY=${KEY}` }), SECRETS)).toThrow(
      "refused: the command holds a credential",
    );
  });

  it("does not quote the credential it refuses", () => {
    let message = "";
    try {
      guard(spawn({ args: [KEY] }), SECRETS);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(KEY.slice(-20));
  });
});
