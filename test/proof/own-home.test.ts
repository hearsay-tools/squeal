import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ownHome, placeKeep } from "../../src/core/proof/own-home.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Review wave-9 B1 (row 023-11; the human, 2026-11-18, "B"): the run's
 * own HOME starts empty and holds copies of the `--home-keep` paths, the
 * hidden paths left out; no link anywhere in it, so nothing in it reaches
 * the real HOME.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "sq-own-home-"));
  dirs.push(dir);
  return dir;
}

/** A throwaway HOME: `.npmrc`, `.gitconfig`, `.config/tool/{rc,other}`, `.config/beside`. */
function homeOf(): string {
  const home = join(temp(), "home");
  mkdirSync(join(home, ".config", "tool"), { recursive: true });
  writeFileSync(join(home, ".npmrc"), "secret\n");
  writeFileSync(join(home, ".gitconfig"), "kept\n");
  writeFileSync(join(home, ".config", "tool", "rc"), "hidden\n");
  writeFileSync(join(home, ".config", "tool", "other"), "kept\n");
  writeFileSync(join(home, ".config", "beside"), "kept\n");
  return home;
}

/** Every path under `dir` that is a link. */
function linksIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("the run's own HOME (review wave-9 B1)", () => {
  it("starts empty: nothing of the real HOME is there unless kept", () => {
    const home = homeOf();
    const own = join(temp(), "own");
    ownHome(home, [".npmrc"], [], own);
    expect(readdirSync(own)).toEqual([]);
  });

  it("copies kept files and folders, never the hidden path, with no link", () => {
    const home = homeOf();
    const own = join(temp(), "own");
    ownHome(home, [".npmrc", ".config/tool/rc"], [".gitconfig", ".config", ".config/tool"], own);
    expect(existsSync(join(own, ".npmrc"))).toBe(false);
    expect(existsSync(join(own, ".config", "tool", "rc"))).toBe(false);
    expect(readFileSync(join(own, ".gitconfig"), "utf8")).toBe("kept\n");
    expect(readFileSync(join(own, ".config", "tool", "other"), "utf8")).toBe("kept\n");
    expect(readFileSync(join(own, ".config", "beside"), "utf8")).toBe("kept\n");
    expect(lstatSync(join(own, ".config")).isDirectory()).toBe(true);
    expect(linksIn(own)).toEqual([]);

    // A write and a delete in the own HOME, through `..` too, change only the copies.
    writeFileSync(join(own, ".config", "..", ".npmrc"), "changed\n");
    writeFileSync(join(own, ".gitconfig"), "changed\n");
    rmSync(join(own, ".config"), { recursive: true });
    rmSync(own, { recursive: true, force: true });
    expect(readFileSync(join(home, ".npmrc"), "utf8")).toBe("secret\n");
    expect(readFileSync(join(home, ".gitconfig"), "utf8")).toBe("kept\n");
    expect(readFileSync(join(home, ".config", "tool", "rc"), "utf8")).toBe("hidden\n");
  });

  it("copies a kept path below a folder without copying the folder's other entries", () => {
    const home = homeOf();
    const own = join(temp(), "own");
    ownHome(home, [".npmrc"], [".config/tool/other"], own);
    expect(readdirSync(join(own, ".config"))).toEqual(["tool"]);
    expect(readdirSync(join(own, ".config", "tool"))).toEqual(["other"]);
  });

  it("throws on a kept path that became a link since it was checked", () => {
    const home = homeOf();
    symlinkSync(join(home, ".npmrc"), join(home, ".config", "tool", "alias"));
    expect(() => ownHome(home, [".npmrc"], [".config"], join(temp(), "own"))).toThrow(
      "~/.config/tool/alias is a link; a kept path must hold none",
    );
  });

  it("places a kept path under HOME, refusing one outside, in the hidden path, missing or with a link", () => {
    const home = homeOf();
    symlinkSync(join(home, ".npmrc"), join(home, ".config", "tool", "alias"));
    symlinkSync(join(home, ".config"), join(home, ".cfg"));
    const cwd = home as AbsolutePath;
    const hidden = [".npmrc", ".config/tool/rc"];
    expect(placeKeep(".gitconfig", cwd, home, hidden)).toEqual({
      given: ".gitconfig",
      path: ".gitconfig",
    });
    const usage = (given: string) =>
      (placeKeep(given, cwd, home, hidden) as { usage: string }).usage;
    expect(usage("/etc/hosts")).toBe("--home-keep /etc/hosts: only a path under HOME can be kept");
    expect(usage(".npmrc")).toBe("--home-keep .npmrc: it lies in the hidden path ~/.npmrc");
    expect(usage(".config/tool/rc")).toBe(
      "--home-keep .config/tool/rc: it lies in the hidden path ~/.config/tool/rc",
    );
    expect(usage(".missing")).toBe("--home-keep .missing: no such file or folder");
    expect(usage(".config")).toBe(
      "--home-keep .config: ~/.config/tool/alias is a link; a kept path must hold none",
    );
    expect(usage(".cfg")).toBe("--home-keep .cfg: ~/.cfg is a link; a kept path must hold none");
    expect(usage(".cfg/beside")).toBe(
      "--home-keep .cfg/beside: ~/.cfg is a link; a kept path must hold none",
    );
    // A folder that holds the hidden path is kept; the hidden path is left out when it is copied.
    rmSync(join(home, ".config", "tool", "alias"));
    expect(placeKeep(".config", cwd, home, hidden)).toEqual({ given: ".config", path: ".config" });
  });
});
