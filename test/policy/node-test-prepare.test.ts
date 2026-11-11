import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";

/*
 * Spec 020 D15.1 (row 020-16b): `nodeTest[].prepare`, `{ command:
 * string[], timeoutSeconds?: number }`. The command is an argument list,
 * never a shell string. A bad value is a problem with that project skipped
 * (spec 003 D1, 001 D11).
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(prepare: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-prepare-"));
  dirs.push(dir);
  const entry = { name: "package", include: ["test/e2e/*.test.mjs"], prepare };
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify({ nodeTest: [entry] }));
  return loadPolicy(dir);
}

const SKIPPED = `; project "package" is skipped`;

describe("policy nodeTest[].prepare (spec 020 D15.1)", () => {
  it("keeps a command, with or without timeoutSeconds", () => {
    for (const prepare of [
      { command: ["node", "scripts/build.mjs"] },
      { command: ["npm", "run", "build", ""], timeoutSeconds: 1.5 },
    ]) {
      const { policy, problems } = load(prepare);
      expect(problems).toEqual([]);
      expect(policy.nodeTest[0]?.prepare).toEqual(prepare);
    }
  });

  it.each([
    [
      "a shell string",
      "npm run build",
      `"nodeTest[0].prepare" must be { command: [executable, ...arguments], timeoutSeconds?: seconds }, got "npm run build"${SKIPPED}`,
    ],
    [
      "a command string",
      { command: "npm run build" },
      `"nodeTest[0].prepare" has a command that is not a list with an executable first: "npm run build"; it takes { command: [executable, ...arguments], timeoutSeconds?: seconds }${SKIPPED}`,
    ],
    [
      "an empty command",
      { command: [] },
      `"nodeTest[0].prepare" has a command that is not a list with an executable first: []; it takes { command: [executable, ...arguments], timeoutSeconds?: seconds }${SKIPPED}`,
    ],
    [
      "an empty executable",
      { command: ["", "build"] },
      `"nodeTest[0].prepare" has a command that is not a list with an executable first: ["","build"]; it takes { command: [executable, ...arguments], timeoutSeconds?: seconds }${SKIPPED}`,
    ],
    [
      "a zero timeout",
      { command: ["node"], timeoutSeconds: 0 },
      `"nodeTest[0].prepare" has a timeoutSeconds that is not a positive number: 0${SKIPPED}`,
    ],
    [
      "an unknown key",
      { command: ["node"], shell: true },
      `"nodeTest[0].prepare" has an unknown key "shell"; it takes { command: [executable, ...arguments], timeoutSeconds?: seconds }${SKIPPED}`,
    ],
  ])("skips the project with %s", (_, prepare, problem) => {
    const { policy, problems } = load(prepare);
    expect(policy.nodeTest).toEqual([]);
    expect(problems).toEqual([problem]);
  });
});
