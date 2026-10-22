import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  capacityReader,
  defaultHostSlots,
  loadUserConfig,
  repositoryRootOf,
  resolveCapacity,
  userConfigPath,
} from "../../src/core/daemon/user-config.js";
import { resolveCommonDir } from "../../src/core/fs/git-layout.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-user-config-")));
  dirs.push(dir);
  return dir;
}

/** Probe isolation: a temp HOME, XDG_CONFIG_HOME and XDG_RUNTIME_DIR, never the real ones. */
function envWith(contents: string | null): NodeJS.ProcessEnv {
  const dir = tempDir();
  const env = {
    HOME: join(dir, "home"),
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_RUNTIME_DIR: join(dir, "run"),
  };
  if (contents !== null) {
    mkdirSync(join(env.XDG_CONFIG_HOME, "squeal"), { recursive: true });
    writeFileSync(join(env.XDG_CONFIG_HOME, "squeal", "config.json"), contents);
  }
  return env;
}

const load = (contents: string | null, cpus = 8) =>
  loadUserConfig({ env: envWith(contents), cpus });

describe("userConfigPath (spec 001 D11 Capacity)", () => {
  it("is $XDG_CONFIG_HOME/squeal/config.json", () => {
    expect(userConfigPath({ XDG_CONFIG_HOME: "/x/config", HOME: "/h" })).toBe(
      "/x/config/squeal/config.json",
    );
  });

  it("is ~/.config/squeal/config.json when XDG_CONFIG_HOME is unset, empty or relative", () => {
    for (const XDG_CONFIG_HOME of [undefined, "", "config"]) {
      expect(userConfigPath({ XDG_CONFIG_HOME, HOME: "/h" })).toBe("/h/.config/squeal/config.json");
    }
  });
});

describe("loadUserConfig (spec 001 D11 Capacity)", () => {
  it("is CPUs - 1 host slots and no projects when the file is absent", () => {
    const { config, problems } = load(null, 24);
    expect(problems).toEqual([]);
    expect(config).toEqual({ capacity: { hostSlots: 23, projects: {} } });
  });

  // 011 C10 Size as amended 2026-10-21 (row 011-98): a slot is a core of the CPU too.
  it("cuts hostSlots above the CPU count to it, and says so for the note", () => {
    const { config, problems, cut } = load(JSON.stringify({ capacity: { hostSlots: 48 } }), 24);
    expect(config.capacity.hostSlots).toBe(24);
    expect(problems).toEqual([]);
    expect(cut).toBe('"capacity.hostSlots" 48 is above the CPU count, 24; it is cut to 24');
    const exact = load(JSON.stringify({ capacity: { hostSlots: 24 } }), 24);
    expect(exact.config.capacity.hostSlots).toBe(24);
    expect(exact.cut).toBeUndefined();
  });

  it("never defaults below one host slot", () => {
    expect(defaultHostSlots(1)).toBe(1);
    expect(load(null, 1).config.capacity.hostSlots).toBe(1);
  });

  it("reads hostSlots and projects", () => {
    const root = tempDir();
    const { config, problems } = load(
      JSON.stringify({ capacity: { hostSlots: 12, projects: { [root]: { slots: 4 } } } }),
      24,
    );
    expect(problems).toEqual([]);
    expect(config).toEqual({ capacity: { hostSlots: 12, projects: { [root]: { slots: 4 } } } });
  });

  it("gives every problem for one note and keeps the defaults and good entries", () => {
    const root = tempDir();
    const { config, problems } = load(
      JSON.stringify({
        capacity: {
          hostSlots: 0,
          projects: {
            [root]: { slots: 3 },
            "relative/repo": { slots: 2 },
            "/srv/zero": { slots: 0 },
            "/srv/extra": { slots: 2, worktrees: 1 },
            "/srv/number": 5,
          },
        },
        maxParallel: 4,
      }),
    );
    expect(problems).toEqual([
      '"capacity.hostSlots" must be a positive integer, got 0',
      '"capacity.projects[relative/repo]" must name an absolute path; it is left out',
      '"capacity.projects[/srv/zero]" "slots" must be a positive integer, got 0; it is left out',
      '"capacity.projects[/srv/extra]" has unknown key "worktrees"; it is left out',
      '"capacity.projects[/srv/number]" must be { "slots": n }, got 5; it is left out',
      'unknown key "maxParallel"',
    ]);
    expect(config).toEqual({ capacity: { hostSlots: 7, projects: { [root]: { slots: 3 } } } });
  });

  it("is the defaults with one problem for a file that is not JSON or not an object", () => {
    const defaults = { capacity: { hostSlots: 7, projects: {} } };
    const bad = load("{ capacity");
    expect(bad.config).toEqual(defaults);
    expect(bad.problems).toHaveLength(1);
    expect(bad.problems[0]).toMatch(/^not valid JSON/);
    expect(load("[]")).toMatchObject({
      config: defaults,
      problems: ["must be a JSON object, got an array"],
    });
    expect(load('{"capacity": 3}').problems).toEqual(['"capacity" must be an object, got 3']);
    expect(load('{"capacity": {"projects": []}}').problems).toEqual([
      '"capacity.projects" must be an object from repository root path to { "slots": n }, got []',
    ]);
  });
});

describe("resolveCapacity (spec 001 D11 Capacity)", () => {
  it("gives a named repository its cap and others none", () => {
    const named = tempDir();
    const config = { capacity: { hostSlots: 10, projects: { [named]: { slots: 4 } } } };
    expect(resolveCapacity(config, named)).toEqual({ hostSlots: 10, projectSlots: 4 });
    expect(resolveCapacity(config, tempDir())).toEqual({ hostSlots: 10 });
  });

  it("never gives a project more than the host", () => {
    const named = tempDir();
    const config = { capacity: { hostSlots: 3, projects: { [named]: { slots: 8 } } } };
    expect(resolveCapacity(config, named)).toEqual({ hostSlots: 3, projectSlots: 3 });
  });

  it("matches a symlinked or trailing-slash spelling of the root", () => {
    const real = tempDir();
    const link = join(tempDir(), "link");
    symlinkSync(real, link);
    const { config } = load(
      JSON.stringify({ capacity: { projects: { [`${link}/`]: { slots: 2 } } } }),
    );
    expect(resolveCapacity(config, real)).toEqual({ hostSlots: 7, projectSlots: 2 });
  });

  it("caps every worktree of a repository by its root, the main worktree's and a linked one's", () => {
    const dir = tempDir();
    const main = join(dir, "main");
    const linked = join(dir, "linked");
    mkdirSync(main);
    const git = (cwd: string, args: string[]) =>
      execFileSync("git", args, { cwd, env: { ...envWith(null), PATH: process.env.PATH } });
    git(main, ["init", "-q", "-b", "main"]);
    git(main, [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    ]);
    git(main, ["worktree", "add", "-q", linked]);
    const { config } = load(JSON.stringify({ capacity: { projects: { [main]: { slots: 2 } } } }));
    for (const root of [main, linked]) {
      const commonDir = resolveCommonDir(root);
      expect(commonDir).not.toBeNull();
      expect(repositoryRootOf(root, commonDir as string)).toBe(main);
      expect(resolveCapacity(config, repositoryRootOf(root, commonDir as string))).toEqual({
        hostSlots: 7,
        projectSlots: 2,
      });
    }
  });
});

describe("capacityReader (spec 001 D11 Capacity)", () => {
  function reader(env: NodeJS.ProcessEnv, lastNote: string | null = null) {
    const notes: string[] = [];
    const read = capacityReader({
      repositoryRoot: "/srv/repo",
      env,
      cpus: 4,
      lastNote: () => notes.at(-1) ?? lastNote,
      note: (text) => notes.push(text),
    });
    return { read, notes };
  }

  it("notes a problem set once and reads an edit at the next call", () => {
    const env = envWith('{"capacity": {"hostSlots": "six"}}');
    const file = userConfigPath(env);
    const { read, notes } = reader(env);
    expect(read()).toEqual({ hostSlots: 3 });
    expect(read()).toEqual({ hostSlots: 3 });
    expect(notes).toEqual([
      `${file}: "capacity.hostSlots" must be a positive integer, got "six"; the defaults apply in their place`,
    ]);

    writeFileSync(file, '{"capacity": {"hostSlots": 4, "projects": {"/srv/repo": {"slots": 2}}}}');
    expect(read()).toEqual({ hostSlots: 4, projectSlots: 2 });
    expect(notes).toHaveLength(1);
  });

  it("notes a hostSlots cut to the CPU count after the file's problems (row 011-98)", () => {
    const env = envWith('{"capacity": {"hostSlots": 6, "projects": 3}}');
    const { read, notes } = reader(env);
    expect(read()).toEqual({ hostSlots: 4 });
    expect(notes).toEqual([
      `${userConfigPath(env)}: "capacity.projects" must be an object from repository root path to { "slots": n }, got 3; the defaults apply in their place; "capacity.hostSlots" 6 is above the CPU count, 4; it is cut to 4`,
    ]);
  });

  it("adds no note when the newest persisted one already says the same (a restart)", () => {
    const env = envWith('{"capacity": {"hostSlots": 0}}');
    const same = `${userConfigPath(env)}: "capacity.hostSlots" must be a positive integer, got 0; the defaults apply in their place`;
    const { read, notes } = reader(env, same);
    read();
    expect(notes).toEqual([]);
  });

  it("notes nothing for a missing or clean file", () => {
    const { read, notes } = reader(envWith(null));
    expect(read()).toEqual({ hostSlots: 3 });
    expect(notes).toEqual([]);
  });
});
