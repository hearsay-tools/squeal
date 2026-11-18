import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  conditionedEnv,
  conditionWords,
  ownHome,
  placeWithout,
} from "../../src/core/proof/conditions.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-11, spec 023 D5.3: where a `--without` path is hidden, the run's
 * environment under the conditions, and the run's own `HOME`.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "sq-conditions-"));
  dirs.push(dir);
  return dir;
}

describe("proof conditions (row 023-11, D5.3)", () => {
  const root = "/home/u/repo" as AbsolutePath;

  it("places a path in the repository first, then under HOME; refuses any other", () => {
    const cwd = join(root, "test") as AbsolutePath;
    expect(placeWithout("fixtures/a.json", cwd, root, "/home/u")).toEqual({
      given: "fixtures/a.json",
      where: "repository",
      path: "test/fixtures/a.json",
    });
    expect(placeWithout("/home/u/.npmrc", cwd, root, "/home/u")).toEqual({
      given: "/home/u/.npmrc",
      where: "home",
      path: ".npmrc",
    });
    expect(placeWithout("/etc/x", cwd, root, "/home/u")).toEqual({
      usage: "--without /etc/x: only a path in the repository or under HOME can be hidden",
    });
    expect(placeWithout("/home/u/.npmrc", cwd, root, undefined)).toHaveProperty("usage");
    for (const whole of [root, join(root, ".git"), join(root, ".git/config")])
      expect(placeWithout(whole, cwd, root, "/home/u")).toEqual({
        usage: `--without ${whole}: the repository and its .git cannot be hidden`,
      });
  });

  it("sets and unsets variables, and gives the run its own HOME", () => {
    const conditions = {
      env: [
        { name: "CI", value: null },
        { name: "TZ", value: "UTC" },
      ],
      without: [],
    };
    expect(conditionedEnv({ CI: "1", HOME: "/home/u", A: "a" }, conditions, "/tmp/h")).toEqual({
      TZ: "UTC",
      HOME: "/tmp/h",
      A: "a",
    });
    expect(
      conditionWords({
        ...conditions,
        without: [{ given: "~/.npmrc", where: "home", path: ".npmrc" }],
      }),
    ).toEqual(["--env CI= (unset)", "--env TZ=UTC", "--without ~/.npmrc (own HOME)"]);
  });

  it("makes a HOME with everything but the hidden paths, as links its removal leaves alone", () => {
    const home = join(temp(), "home");
    mkdirSync(join(home, ".config", "tool"), { recursive: true });
    writeFileSync(join(home, ".npmrc"), "secret\n");
    writeFileSync(join(home, ".gitconfig"), "kept\n");
    writeFileSync(join(home, ".config", "tool", "rc"), "hidden\n");
    writeFileSync(join(home, ".config", "tool", "other"), "kept\n");
    writeFileSync(join(home, ".config", "beside"), "kept\n");
    const own = join(temp(), "own");
    ownHome(home, [".npmrc", ".config/tool/rc"], own);

    expect(existsSync(join(own, ".npmrc"))).toBe(false);
    expect(existsSync(join(own, ".config", "tool", "rc"))).toBe(false);
    expect(readFileSync(join(own, ".gitconfig"), "utf8")).toBe("kept\n");
    expect(readFileSync(join(own, ".config", "beside"), "utf8")).toBe("kept\n");
    expect(readFileSync(join(own, ".config", "tool", "other"), "utf8")).toBe("kept\n");
    // The folders on the way to a hidden path are its own; the rest are links.
    expect(lstatSync(join(own, ".config")).isDirectory()).toBe(true);
    expect(readlinkSync(join(own, ".gitconfig"))).toBe(join(home, ".gitconfig"));

    rmSync(own, { recursive: true, force: true });
    expect(readFileSync(join(home, ".config", "tool", "other"), "utf8")).toBe("kept\n");
    expect(readFileSync(join(home, ".npmrc"), "utf8")).toBe("secret\n");
  });

  it("hides all of HOME for the HOME folder itself", () => {
    const home = temp();
    writeFileSync(join(home, ".npmrc"), "secret\n");
    const own = join(temp(), "own");
    ownHome(home, [""], own);
    expect(existsSync(join(own, ".npmrc"))).toBe(false);
    expect(lstatSync(own).isDirectory()).toBe(true);
  });
});
