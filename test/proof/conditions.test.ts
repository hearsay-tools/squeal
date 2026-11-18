import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conditionedEnv,
  conditionWords,
  linkOnPath,
  placeWithout,
} from "../../src/core/proof/conditions.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-11, spec 023 D5.3: where a `--without` path is hidden, the run's
 * environment under the conditions (the run's own `HOME`: `own-home.test.ts`).
 */

describe("proof conditions (row 023-11, D5.3)", () => {
  const root = "/srv/repo" as AbsolutePath;

  it("places a path in the repository first, then under HOME; refuses any other", () => {
    const cwd = join(root, "test") as AbsolutePath;
    expect(placeWithout("fixtures/a.json", cwd, root, "/srv/user")).toEqual({
      given: "fixtures/a.json",
      where: "repository",
      path: "test/fixtures/a.json",
    });
    expect(placeWithout("/srv/user/.npmrc", cwd, root, "/srv/user")).toEqual({
      given: "/srv/user/.npmrc",
      where: "home",
      path: ".npmrc",
    });
    expect(placeWithout("/etc/x", cwd, root, "/srv/user")).toEqual({
      usage: "--without /etc/x: only a path in the repository or under HOME can be hidden",
    });
    expect(placeWithout("/srv/user/.npmrc", cwd, root, undefined)).toHaveProperty("usage");
    for (const whole of [root, join(root, ".git"), join(root, ".git/config")])
      expect(placeWithout(whole, cwd, root, "/srv/user")).toEqual({
        usage: `--without ${whole}: the repository and its .git cannot be hidden`,
      });
  });

  it("finds a link at a hidden path or above it in a commit's tree (review wave-9 B2)", () => {
    const entries = new Map([
      ["linked", { mode: "120000" }],
      ["config/local", { mode: "100644" }],
      ["config/alias", { mode: "120000" }],
    ]);
    expect(linkOnPath("linked/victim/inner", entries)).toBe("linked");
    expect(linkOnPath("linked", entries)).toBe("linked");
    expect(linkOnPath("config/alias", entries)).toBe("config/alias");
    expect(linkOnPath("config/local", entries)).toBeNull();
    expect(linkOnPath("config", entries)).toBeNull();
  });

  it("sets and unsets variables, and gives the run its own HOME", () => {
    const conditions = {
      env: [
        { name: "CI", value: null },
        { name: "TZ", value: "UTC" },
      ],
      without: [],
      keep: [],
    };
    expect(conditionedEnv({ CI: "1", HOME: "/srv/user", A: "a" }, conditions, "/tmp/h")).toEqual({
      TZ: "UTC",
      HOME: "/tmp/h",
      A: "a",
    });
    expect(
      conditionWords({
        ...conditions,
        without: [{ given: "~/.npmrc", where: "home", path: ".npmrc" }],
        keep: [{ given: "~/.gitconfig", path: ".gitconfig" }],
      }),
    ).toEqual([
      "--env CI= (unset)",
      "--env TZ=UTC",
      "--without ~/.npmrc (own HOME)",
      "--home-keep ~/.gitconfig (copied into own HOME)",
    ]);
  });
});
