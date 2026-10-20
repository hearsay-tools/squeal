import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { appendRevisions, type FakeRepo, fakeRepo, seedStore } from "../status/helpers.js";

/**
 * Row 011-07, issue 21: `squeal status` names a `squeal.config.json`
 * problem the policy loader reports, with and without a store, in text and
 * JSON; a valid config changes nothing and no exit code moves.
 */

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const NEGATED = { inputs: { "a.test.mjs": ["!docs/**"] } };
const VALID = { inputs: { "a.test.mjs": ["docs/**"] } };
const PROBLEM =
  '"inputs" has a glob Squeal cannot use: squeal: negated input glob is not supported: !docs/**';
const LINE = `Config problem: squeal.config.json: ${PROBLEM}; the defaults apply in their place (\`squeal setup --check\` names each)`;

function run(argv: string[], cwd: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
    now: () => NOW,
    env: {},
  };
  return { code: main(argv, io), stdout };
}

function writeConfig(repo: FakeRepo, config: object | null) {
  const path = join(repo.main, "squeal.config.json");
  if (config === null) rmSync(path, { force: true });
  else writeFileSync(path, `${JSON.stringify(config)}\n`);
}

function withStore(): FakeRepo {
  const repo = fakeRepo();
  appendRevisions(seedStore(repo), repo.mainId, 1, { head: null, dirty: false });
  return repo;
}

describe("squeal status names a squeal.config.json problem (011-07)", () => {
  it("without a store: the no-store line, then the problem; exit 1 as before", () => {
    const repo = fakeRepo();
    writeConfig(repo, NEGATED);

    const human = run(["status"], repo.main);
    const json = run(["status", "--json"], repo.main);

    expect(human.code).toBe(1);
    expect(human.stdout.split("\n")).toEqual([
      expect.stringMatching(/^Status unavailable, no Squeal store at /),
      LINE,
      "",
    ]);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({
      available: false,
      reason: "no-store",
      configProblems: [PROBLEM],
    });
  });

  it("with a store: one line after the checkpoint and outstanding lines; exit 0 as before", () => {
    const repo = withStore();
    writeConfig(repo, NEGATED);

    const human = run(["status"], repo.main);
    const json = run(["status", "--json"], repo.main);

    expect(human.code).toBe(0);
    const lines = human.stdout.split("\n");
    expect(lines.filter((line) => line === LINE)).toHaveLength(1);
    // Row 011-29: the coverage lines follow the outstanding work, and the `More:` line them.
    expect(lines.indexOf(LINE)).toBeGreaterThan(lines.findIndex((l) => l.startsWith("Full-suite")));
    expect(lines[lines.indexOf(LINE) - 1]).toMatch(/^Outstanding:$|^ {2}/);
    expect(lines[lines.indexOf(LINE) + 1]).toMatch(/^More: /);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ available: true, configProblems: [PROBLEM] });
  });

  it("a valid config yields the output of no config, byte for byte, with and without a store", () => {
    for (const repo of [fakeRepo(), withStore()]) {
      const before = [run(["status"], repo.main), run(["status", "--json"], repo.main)];
      writeConfig(repo, VALID);
      const after = [run(["status"], repo.main), run(["status", "--json"], repo.main)];

      expect(after).toEqual(before);
      expect(after[1]?.stdout).not.toContain("configProblems");
    }
  });
});
