import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cellEnv, pathFirst, squealBin } from "../../evals/lib/index.mjs";
import { userConfigPath } from "../../src/core/daemon/user-config.js";

// 006-62: in the a8 run 18 of 20 Claude cells' bare `squeal` was the host's `~/.local/bin`
// launcher, which read the cell's empty HOME and answered `no squeal@hearsay plugin is
// installed`. A cell's `squeal` resolves to the pinned plugin's CLI in both harnesses, ahead of
// any `squeal` the host's PATH holds.

const REPO = join(import.meta.dirname, "../..");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const write = (p: string, s: string, mode = 0o644) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
  chmodSync(p, mode);
};
const says = (word: string) =>
  `console.log(${JSON.stringify(word)}, process.argv.slice(2).join(" "));\n`;

/** A host whose PATH starts with a launcher of its own, a pin, and a cell, all in a temp dir. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "squeal-cell-bin-"));
  dirs.push(dir);
  const hostBin = join(dir, "host/.local/bin");
  write(join(hostBin, "squeal"), '#!/bin/sh\necho "host launcher"\nexit 1\n', 0o755);
  const pin = join(dir, "pin");
  for (const [p, f] of [
    ["claude-code", "squeal"],
    ["codex", "squeal-launcher"],
  ] as const) {
    mkdirSync(join(pin, "plugins", p, "bin"), { recursive: true });
    copyFileSync(join(REPO, "plugins", p, "bin", f), join(pin, "plugins", p, "bin", f));
  }
  write(join(pin, "plugins/claude-code/dist/cli/squeal.mjs"), says("pinned claude-code"));
  const cell = join(dir, "cell");
  // `codex plugin add` installs the pin into the cell's CODEX_HOME.
  write(
    join(cell, "codex/plugins/cache/hearsay/squeal/0.1.0/dist/cli/squeal.mjs"),
    says("pinned codex"),
  );
  mkdirSync(join(cell, "home"), { recursive: true });
  const host = {
    PATH: `${hostBin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(dir, "host"),
  };
  return { host, pin, cell };
}

const bare = (env: Record<string, string | undefined>, cwd: string) =>
  spawnSync("sh", ["-c", "squeal --version"], { env, cwd, encoding: "utf8" }).stdout.trim();

describe("a cell's bare squeal", () => {
  it.each([
    ["claude", "pinned claude-code --version"],
    ["codex", "pinned codex --version"],
  ] as const)("in %s is the pinned plugin's, not the host's launcher", (harness, expected) => {
    const { host, pin, cell } = fixture();
    const env = cellEnv(host, cell);
    // Without 006-62's PATH the host's launcher answers.
    expect(bare(env, cell)).toBe("host launcher");
    env.PATH = pathFirst(env.PATH, squealBin(harness, cell, pin));
    expect(bare(env, cell)).toBe(expected);
  });

  // Review 006-63 B1: format 4 runs the newest Squeal across harnesses, Pi's and OpenCode's
  // packages under XDG_DATA_HOME among them, so a newer package in the host's data directory won
  // over the pin while meta.json said `squealPath: "pinned"`.
  it.each([
    ["claude", "pi"],
    ["claude", "opencode"],
    ["codex", "pi"],
    ["codex", "opencode"],
  ] as const)("in %s runs no newer %s package from the host's data directory", (harness, pkg) => {
    const { host, pin, cell } = fixture();
    const data = join(host.HOME, ".local/share");
    write(join(data, "squeal", pkg, "9.9.9/dist/cli/squeal.mjs"), says("host data"));
    const env = cellEnv({ ...host, XDG_DATA_HOME: data }, cell);
    env.PATH = pathFirst(env.PATH, squealBin(harness, cell, pin));
    expect(bare(env, cell)).toBe(
      `pinned ${harness === "codex" ? "codex" : "claude-code"} --version`,
    );
    // Every XDG base directory is the cell's, so is the user config Squeal's daemon reads.
    for (const k of ["XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"])
      expect(env[k]?.startsWith(join(cell, "home/"))).toBe(true);
    expect(userConfigPath({ ...host, XDG_CONFIG_HOME: join(host.HOME, ".config") })).not.toBe(
      userConfigPath(env),
    );
    expect(userConfigPath(env).startsWith(join(cell, "home/"))).toBe(true);
  });

  it("puts the directory first once", () => {
    expect(pathFirst("/a:/b:/a", "/b")).toBe("/b:/a:/a");
    expect(pathFirst(undefined, "/b")).toBe("/b");
  });
});
