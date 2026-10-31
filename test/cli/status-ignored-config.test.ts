import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { CODE_OFF } from "../helpers/policy.js";
import { appendRevisions, type FakeRepo, fakeRepo, seedStore } from "../status/helpers.js";

/*
 * Row 011-275 (gh-120): `squeal status` names the `squeal.config.json` keys
 * a runtime of the worktree does not apply, in text and JSON alike, apart
 * from the configuration in force; only known keys change nothing.
 */

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const OWN = squealVersion();
const RULE = { project: "e2e", tests: ["e2e/*.e2e.ts"], paths: [".ai/qa/test-env.json"] };

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

function writeConfig(repo: FakeRepo, config: object) {
  writeFileSync(join(repo.main, "squeal.config.json"), `${JSON.stringify(config)}\n`);
}

/** A store whose worktree row records a live daemon of `version`. */
function withDaemon(version: string): FakeRepo {
  const repo = fakeRepo();
  const store = seedStore(repo);
  appendRevisions(store, repo.mainId, 1, { head: null, dirty: false });
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: "/run/squeal.sock",
      startedAt: 1,
      heartbeatAt: NOW - 1_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: version,
    },
  });
  return repo;
}

const notApplied = (text: string) => text.split("\n").filter((l) => l.startsWith("Not applied: "));

describe("squeal status names configuration a runtime here does not apply (011-275)", () => {
  it("an unknown key beside a recognized one, a daemon of 0.1.368 and runtimeFiles", () => {
    const repo = withDaemon("0.1.368");
    writeConfig(repo, { ...CODE_OFF, runner: { tierSize: 2 }, runtimeFiles: [RULE], futureKey: 1 });

    const human = run(["status"], repo.main);
    const json = JSON.parse(run(["status", "--json"], repo.main).stdout);

    expect(human.code).toBe(0);
    expect(json.ignoredConfig).toEqual([
      { key: "futureKey", by: "command", version: OWN, daemonVersion: "0.1.368" },
      {
        key: "runtimeFiles",
        by: "daemon",
        version: "0.1.368",
        addedIn: "0.1.369",
        cost: expect.stringMatching(/^extra re-runs: /),
      },
    ]);
    // The loader's list stays as `setup --check` names it.
    expect(json.configProblems).toEqual(['unknown key "futureKey"']);
    const lines = notApplied(human.stdout);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`key "futureKey" is unknown to squeal ${OWN}`);
    expect(lines[0]).toContain("the daemon runs squeal 0.1.368, and whether it applies it");
    expect(lines[1]).toContain('key "runtimeFiles": the daemon runs squeal 0.1.368');
    expect(lines[1]).toContain(`Cost: ${json.ignoredConfig[1].cost}.`);
    // Ignored apart from applied: no text says a default stands in for the unknown key.
    expect(human.stdout).not.toMatch(/^Config problem/m);
    expect(human.stdout).not.toMatch(/runner\.tierSize|"runner"/);
  });

  it("only known keys: no field, no line, with a daemon that knows them all", () => {
    const repo = withDaemon(OWN);
    writeConfig(repo, { ...CODE_OFF, runner: { tierSize: 2 }, runtimeFiles: [RULE] });

    const human = run(["status"], repo.main);
    const json = run(["status", "--json"], repo.main);

    expect(notApplied(human.stdout)).toEqual([]);
    expect(json.stdout).not.toContain("ignoredConfig");
  });

  it("without a store: the unknown key with this version, no daemon named", () => {
    const repo = fakeRepo();
    writeConfig(repo, { futureKey: 1 });

    const human = run(["status"], repo.main);
    const json = run(["status", "--json"], repo.main);

    expect(human.code).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({
      available: false,
      configProblems: ['unknown key "futureKey"'],
      ignoredConfig: [{ key: "futureKey", by: "command", version: OWN }],
    });
    const lines = human.stdout.split("\n");
    expect(lines[0]).toMatch(/^Status unavailable, no Squeal store at /);
    expect(lines[1]).toMatch(/^Not applied: squeal\.config\.json key "futureKey" is unknown/);
    expect(lines[1]).not.toContain("the daemon runs");
    expect(lines).toHaveLength(3);
  });
});
