import { chmodSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathFirst, pinnedNode, readPin } from "../../src/core/node-pin.js";
import { tempDir } from "../store/helpers.js";
import { fakeHome, fakeNode, nvmNode, rootWith } from "./helpers.js";

/*
 * Spec 018 D18 (row 018-30): which Node a worktree's daemon runs on. Fake
 * installs under a temporary HOME; the pinned versions are ones no real
 * Node has, so only a fake can answer them.
 */

const PINNED = "99.1.2";

describe("pinnedNode (018 D18)", () => {
  it("finds the nvm install of an exact pin, with or without a leading v", () => {
    const { home, env } = fakeHome();
    const binary = fakeNode(nvmNode(home, PINNED), PINNED);
    for (const pin of [`v${PINNED}`, PINNED, ` v${PINNED} \n`]) {
      expect(pinnedNode(rootWith({ ".node-version": pin }), env)).toEqual({
        binary,
        version: PINNED,
      });
      expect(pinnedNode(rootWith({ ".nvmrc": pin }), env)).toEqual({ binary, version: PINNED });
    }
  });

  it("is `none` without a pin file, or with only comments and blank lines in it", () => {
    const { home, env } = fakeHome();
    fakeNode(nvmNode(home, PINNED), PINNED);
    expect(pinnedNode(rootWith({}), env)).toEqual({ reason: "none" });
    expect(pinnedNode(rootWith({ ".nvmrc": "# no version\n\n" }), env)).toEqual({
      reason: "none",
    });
  });

  it("reads .node-version before .nvmrc, and skips comments", () => {
    const root = rootWith({ ".node-version": "# pinned\n\nv1.2.3 # CI's\n", ".nvmrc": "v4.5.6" });
    expect(readPin(root)).toBe("v1.2.3");
    expect(readPin(rootWith({ ".nvmrc": "lts/*\n" }))).toBe("lts/*");
  });

  it.each(["lts/*", "26", "26.13", ">=26.13.0", "node", "v26.13.0-rc.1"])(
    "does not resolve a range or alias: %s is `range`, with the pin's text",
    (pin) => {
      const { env } = fakeHome();
      expect(pinnedNode(rootWith({ ".node-version": pin }), env)).toEqual({
        reason: "range",
        wanted: pin,
      });
    },
  );

  it("is `missing` when the pinned version is not installed, naming the pin", () => {
    const { home, env } = fakeHome();
    fakeNode(nvmNode(home, PINNED), PINNED);
    expect(pinnedNode(rootWith({ ".node-version": "v99.1.3" }), env)).toEqual({
      reason: "missing",
      wanted: "v99.1.3",
    });
  });

  it("checks a candidate by running it: another version or no execute bit is not the pin", () => {
    const { home, env } = fakeHome();
    const binary = fakeNode(nvmNode(home, PINNED), "99.0.0");
    const root = rootWith({ ".node-version": PINNED });
    expect(pinnedNode(root, env)).toEqual({ reason: "missing", wanted: PINNED });
    fakeNode(binary, PINNED);
    chmodSync(binary, 0o644);
    expect(pinnedNode(root, env)).toEqual({ reason: "missing", wanted: PINNED });
  });

  it('keeps the session\'s Node with `node: "session"`, naming the pin when there is one', () => {
    const { home, env } = fakeHome();
    fakeNode(nvmNode(home, PINNED), PINNED);
    const config = JSON.stringify({ node: "session" });
    expect(
      pinnedNode(rootWith({ ".node-version": PINNED, "squeal.config.json": config }), env),
    ).toEqual({ reason: "session", wanted: PINNED });
    expect(pinnedNode(rootWith({ "squeal.config.json": config }), env)).toEqual({
      reason: "session",
    });
    const project = JSON.stringify({ node: "project" });
    expect(
      pinnedNode(rootWith({ ".node-version": PINNED, "squeal.config.json": project }), env),
    ).toMatchObject({ version: PINNED });
  });

  it("answers the session's own Node at the pinned version without a lookup", () => {
    const { env } = fakeHome();
    const own = process.versions.node;
    expect(pinnedNode(rootWith({ ".nvmrc": `v${own}` }), env)).toEqual({
      binary: process.execPath,
      version: own,
    });
  });

  it.each([
    ["nvm under NVM_DIR", { NVM_DIR: "nvm" }, ["nvm", "versions", "node", "v@", "bin"]],
    ["fnm under XDG", {}, [".local", "share", "fnm", "node-versions", "v@", "installation", "bin"]],
    ["fnm under ~/.fnm", {}, [".fnm", "node-versions", "v@", "installation", "bin"]],
    ["fnm under FNM_DIR", { FNM_DIR: "f" }, ["f", "node-versions", "v@", "installation", "bin"]],
    ["volta", {}, [".volta", "tools", "image", "node", "@", "bin"]],
    ["volta under VOLTA_HOME", { VOLTA_HOME: "v" }, ["v", "tools", "image", "node", "@", "bin"]],
    ["asdf", {}, [".asdf", "installs", "nodejs", "@", "bin"]],
    ["asdf under ASDF_DATA_DIR", { ASDF_DATA_DIR: "a" }, ["a", "installs", "nodejs", "@", "bin"]],
    ["mise", {}, [".local", "share", "mise", "installs", "node", "@", "bin"]],
    ["mise under MISE_DATA_DIR", { MISE_DATA_DIR: "m" }, ["m", "installs", "node", "@", "bin"]],
    ["n under N_PREFIX", {}, ["n-prefix", "n", "versions", "node", "@", "bin"]],
  ] as const)("finds %s", (_, variables, parts) => {
    const fake = fakeHome();
    const env = { ...fake.env };
    for (const [name, dir] of Object.entries(variables)) env[name] = join(fake.home, dir);
    const dir = join(fake.home, ...parts.map((p) => p.replace("@", PINNED)));
    const binary = fakeNode(join(dir, "node"), PINNED);
    expect(pinnedNode(rootWith({ ".node-version": PINNED }), env)).toEqual({
      binary,
      version: PINNED,
    });
  });

  it("takes nvm's install before another manager's", () => {
    const { home, env } = fakeHome();
    const nvm = fakeNode(nvmNode(home, PINNED), PINNED);
    fakeNode(join(home, ".volta", "tools", "image", "node", PINNED, "bin", "node"), PINNED);
    expect(pinnedNode(rootWith({ ".node-version": PINNED }), env)).toMatchObject({ binary: nvm });
  });

  it("finds a node on PATH by the binary it runs, asked from the worktree root", () => {
    const bin = tempDir("squeal-node-pin-path-");
    const { env } = fakeHome([dirname(process.execPath), bin].join(delimiter));
    const root = rootWith({ ".node-version": PINNED });
    const real = fakeNode(join(tempDir("squeal-node-pin-real-"), "node"), PINNED);
    // A version manager's shim: the version depends on the directory it runs in.
    writeFileSync(
      join(bin, "node"),
      `#!/bin/sh\nif [ "$PWD" = '${root}' ]; then echo v${PINNED}; else echo v1.0.0; fi\necho '${real}'\n`,
    );
    chmodSync(join(bin, "node"), 0o755);
    expect(pinnedNode(root, env)).toEqual({ binary: real, version: PINNED });
    expect(pinnedNode(rootWith({ ".node-version": "v99.1.3" }), env)).toEqual({
      reason: "missing",
      wanted: "v99.1.3",
    });
  });

  it("runs each candidate once per process while its file is unchanged", () => {
    const { home, env } = fakeHome();
    const count = join(tempDir("squeal-node-pin-count-"), "count");
    const binary = fakeNode(nvmNode(home, PINNED), PINNED, { count });
    const root = rootWith({ ".node-version": PINNED });
    for (let i = 0; i < 3; i++) expect(pinnedNode(root, env)).toMatchObject({ binary });
    expect(readFileSync(count, "utf8")).toBe("x\n");
    const later = Date.now() / 1000 + 60;
    utimesSync(binary, later, later);
    expect(pinnedNode(root, env)).toMatchObject({ binary });
    expect(readFileSync(count, "utf8")).toBe("x\nx\n");
  });
});

describe("pathFirst (018 D18)", () => {
  it("puts the binary's directory first in PATH", () => {
    expect(pathFirst("/n/v26/bin/node", `/usr/bin${delimiter}/bin`)).toBe(
      `/n/v26/bin${delimiter}/usr/bin${delimiter}/bin`,
    );
    expect(pathFirst("/n/v26/bin/node", undefined)).toBe("/n/v26/bin");
    expect(pathFirst("/n/v26/bin/node", "")).toBe("/n/v26/bin");
  });
});
