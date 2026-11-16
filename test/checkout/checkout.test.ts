import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copyIntoCheckout,
  createCheckout,
  removeCheckout,
} from "../../src/core/checkout/checkout.js";
import { installCheckout } from "../../src/core/checkout/install.js";
import { readMarker, writeMarker } from "../../src/core/checkout/marker.js";
import { listCheckouts, sweepCheckouts } from "../../src/core/checkout/sweep.js";
import { pidNamespace } from "../../src/core/delivery/harness-process.js";

/*
 * Row 023-05 (spec 023 D4.1 to D4.3, D4.8, D6): a temporary checkout on a
 * git fixture under `$TMPDIR`. The npm fixture depends on a `file:` package
 * inside the repository, so `npm ci --offline` installs it with no network.
 */

const LOCK = {
  name: "fixture",
  version: "1.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": {
      name: "fixture",
      version: "1.0.0",
      dependencies: { "local-dep": "file:./vendor/local-dep" },
    },
    "node_modules/local-dep": { resolved: "vendor/local-dep", link: true },
    "vendor/local-dep": { version: "1.0.0" },
  },
};

let base: string;
let repo: string;
let commonDir: string;
let dir: string;
let first: string;
let env: NodeJS.ProcessEnv;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "squeal-checkout-")));
  repo = join(base, "repo");
  dir = join(base, "checkouts");
  env = {
    ...process.env,
    HOME: join(base, "home"),
    npm_config_cache: join(base, "npm-cache"),
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  write(
    join(repo, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      private: true,
      dependencies: { "local-dep": "file:./vendor/local-dep" },
    }),
  );
  write(join(repo, "package-lock.json"), JSON.stringify(LOCK, null, 2));
  write(
    join(repo, "vendor/local-dep/package.json"),
    JSON.stringify({ name: "local-dep", version: "1.0.0", main: "index.js" }),
  );
  write(join(repo, "vendor/local-dep/index.js"), "module.exports = 42;\n");
  write(join(repo, "test/a.test.js"), "first\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "first");
  first = git(repo, "rev-parse", "HEAD").trim();
  write(join(repo, "test/a.test.js"), "second\n");
  write(join(repo, "test/helper/b.js"), "helper\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "second");
  commonDir = realpathSync(join(repo, ".git"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const worktreePaths = () =>
  git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

describe("a temporary checkout", () => {
  it("is created at the commit, installed offline, given a copied file, and removed without a trace", async () => {
    const checkout = await createCheckout({ root: repo, commonDir, commit: "HEAD~1", dir });

    expect(checkout.commit).toBe(first);
    expect(git(checkout.tree, "rev-parse", "HEAD").trim()).toBe(first);
    expect(readFileSync(join(checkout.tree, "test/a.test.js"), "utf8")).toBe("first\n");
    const porcelain = git(repo, "worktree", "list", "--porcelain");
    expect(porcelain).toContain(
      `worktree ${checkout.tree}\nHEAD ${first}\ndetached\nlocked squeal`,
    );
    expect(readMarker(checkout.folder)).toMatchObject({
      owner: { pid: process.pid },
      commit: first,
      commonDir,
    });
    expect(readdirSync(checkout.run)).toEqual([]);

    const installed = await installCheckout(checkout.tree, { timeoutMs: 60_000, env });
    expect(installed).toMatchObject({ ok: true, command: "npm ci" });
    expect(existsSync(join(checkout.tree, "node_modules/local-dep/index.js"))).toBe(true);

    copyIntoCheckout(checkout, repo, ["test/a.test.js", "test/helper/b.js"]);
    expect(readFileSync(join(checkout.tree, "test/a.test.js"), "utf8")).toBe("second\n");
    expect(readFileSync(join(checkout.tree, "test/helper/b.js"), "utf8")).toBe("helper\n");
    expect(() => copyIntoCheckout(checkout, repo, ["../outside.js"])).toThrow(/not a path inside/);

    await removeCheckout(checkout);
    expect(worktreePaths()).toEqual([repo]);
    expect(existsSync(checkout.folder)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("stops the given process group before it removes the tree", async () => {
    const checkout = await createCheckout({ root: repo, commonDir, commit: "HEAD", dir });
    // The run's group: a leader and a child of it, both in the tree.
    const leader = spawn("sh", ["-c", "sleep 60 & wait"], {
      cwd: checkout.tree,
      detached: true,
      stdio: "ignore",
    });
    const group = leader.pid as number;
    const ended = new Promise((resolve) => leader.on("exit", resolve));
    await removeCheckout(checkout, { group });
    await ended;
    expect(() => process.kill(-group, 0)).toThrow();
    expect(worktreePaths()).toEqual([repo]);
  });

  it("returns the install's log when the frozen install fails", async () => {
    const checkout = await createCheckout({ root: repo, commonDir, commit: "HEAD", dir });
    // The manifest no longer matches the lockfile, and offline npm cannot fetch the new package.
    write(
      join(checkout.tree, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: { other: "1.0.0" } }),
    );
    const installed = await installCheckout(checkout.tree, { timeoutMs: 60_000, env });
    expect(installed.ok).toBe(false);
    if (installed.ok) return;
    expect(installed.command).toBe("npm ci");
    expect(installed.reason).toMatch(/^exit /);
    expect(installed.log).toMatch(/npm error/);
    await removeCheckout(checkout);
  });
});

describe("copy-in and symlinks (review wave-1 B3)", () => {
  /**
   * Commit A tracks `test/helper.ts` as a link to the user's `src/user.ts`
   * and `test/data` as a link to the user's `src/data`; commit B, HEAD,
   * makes both a regular file and a folder. Returns A.
   */
  function linkedBase(): string {
    write(join(repo, "src/user.ts"), "original user content\n");
    write(join(repo, "src/data/fixture.json"), "original fixture\n");
    mkdirSync(join(repo, "test"), { recursive: true });
    symlinkSync(join(repo, "src/user.ts"), join(repo, "test/helper.ts"));
    symlinkSync(join(repo, "src/data"), join(repo, "test/data"));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "links");
    const linked = git(repo, "rev-parse", "HEAD").trim();
    rmSync(join(repo, "test/helper.ts"));
    rmSync(join(repo, "test/data"));
    write(join(repo, "test/helper.ts"), "new helper content\n");
    write(join(repo, "test/data/fixture.json"), "new fixture\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "files");
    return linked;
  }

  /** Every file of the user's `src`, with its bytes. */
  const userFiles = () =>
    Object.fromEntries(
      ["src/user.ts", "src/data/fixture.json"].map((f) => [f, readFileSync(join(repo, f))]),
    );

  it("replaces a symlink at the destination instead of writing through it", async () => {
    const checkout = await createCheckout({ root: repo, commonDir, commit: linkedBase(), dir });
    const before = userFiles();
    expect(lstatSync(join(checkout.tree, "test/helper.ts")).isSymbolicLink()).toBe(true);

    copyIntoCheckout(checkout, repo, ["test/helper.ts"]);

    expect(userFiles()).toEqual(before);
    expect(readFileSync(join(repo, "src/user.ts"), "utf8")).toBe("original user content\n");
    const copied = join(checkout.tree, "test/helper.ts");
    expect(lstatSync(copied).isSymbolicLink()).toBe(false);
    expect(readFileSync(copied, "utf8")).toBe("new helper content\n");
    await removeCheckout(checkout);
  });

  it("refuses a destination under a symlinked folder and leaves the user's tree as it was", async () => {
    const checkout = await createCheckout({ root: repo, commonDir, commit: linkedBase(), dir });
    const before = userFiles();
    expect(lstatSync(join(checkout.tree, "test/data")).isSymbolicLink()).toBe(true);

    expect(() => copyIntoCheckout(checkout, repo, ["test/data/fixture.json"])).toThrow(
      /under a symlink in the checkout/,
    );
    expect(() => copyIntoCheckout(checkout, repo, ["test/data/new.json"])).toThrow(
      /under a symlink in the checkout/,
    );

    expect(userFiles()).toEqual(before);
    expect(readdirSync(join(repo, "src/data"))).toEqual(["fixture.json"]);
    await removeCheckout(checkout);
    expect(userFiles()).toEqual(before);
  });
});

describe("the sweep", () => {
  /** A pid that is surely gone: a child that has exited, its start time a value no process has. */
  function deadOwner() {
    const ended = spawnSync(process.execPath, ["-e", ""]);
    return { pid: ended.pid as number, startTime: 1, pidNamespace: pidNamespace() };
  }

  it("removes a checkout whose marker names a dead owner and keeps a live one", async () => {
    const dead = await createCheckout({ root: repo, commonDir, commit: "HEAD~1", dir });
    const live = await createCheckout({ root: repo, commonDir, commit: "HEAD", dir });
    const marker = readMarker(dead.folder);
    if (marker === null) throw new Error("no marker");
    writeMarker(dead.folder, { ...marker, owner: deadOwner() });
    expect(listCheckouts([dir]).map((c) => [c.folder, c.owner])).toEqual(
      [
        [dead.folder, "dead"],
        [live.folder, "live"],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );

    const swept = await sweepCheckouts({ commonDir, dirs: [dir] });

    expect(swept.map((c) => c.folder)).toEqual([dead.folder]);
    expect(existsSync(dead.folder)).toBe(false);
    expect(existsSync(live.tree)).toBe(true);
    expect(worktreePaths()).toEqual([repo, live.tree]);
    await removeCheckout(live);
    expect(worktreePaths()).toEqual([repo]);
  });

  it("removes a folder a create left without a marker", async () => {
    const half = join(dir, "half-made");
    mkdirSync(join(half, "run"), { recursive: true });
    const swept = await sweepCheckouts({ commonDir, dirs: [dir] });
    expect(swept.map((c) => c.folder)).toEqual([half]);
    expect(readdirSync(dir)).toEqual([]);
  });
});
