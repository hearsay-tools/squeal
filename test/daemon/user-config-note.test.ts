import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { userConfigPath } from "../../src/core/daemon/user-config.js";
import { daemonSuite, readNotes, SLOW, stopProcess, waitReady } from "./helpers.js";

const suite = daemonSuite();
const { fixture, daemon } = suite;

describe("squeal daemon: a bad user-level config is a state (spec 001 D11 Capacity)", SLOW, () => {
  it("gives one note and a running daemon, across starts and a restart", async () => {
    const repo = fixture();
    // `childEnv` points XDG_CONFIG_HOME into the test's runtime dir.
    const file = userConfigPath(repo.env);
    expect(file.startsWith(repo.runtimeDir)).toBe(true);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, '{"capacity": {"hostSlots": -1, "worktrees": 2}}');
    const notes = () => readNotes(repo).filter((text) => text.startsWith(file));

    const first = daemon(repo);
    await waitReady(repo, first);
    const again = daemon(repo);
    expect(await again.exited).toEqual({ code: 0, signal: null });
    expect(first.child.exitCode).toBeNull();
    const expected = [
      `${file}: "capacity.hostSlots" must be a positive integer, got -1; unknown key "capacity.worktrees"; the defaults apply in their place`,
    ];
    expect(notes()).toEqual(expected);

    await stopProcess(first);
    const second = daemon(repo);
    await waitReady(repo, second);
    expect(notes()).toEqual(expected);
  });
});
