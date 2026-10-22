import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  claudeInstalls,
  claudeLoaded,
  codexNewest,
  manifestVersion,
  squealVersion,
  UNKNOWN_VERSION,
} from "../../src/core/daemon/version.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { runtimeDir } from "./bundle-helpers.js";

const ROOT_VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string }
).version;

/*
 * Review wave 3, B1: one version source. The bundles get the root manifest's
 * version through an esbuild `define`; the `tsc` build walks up to the
 * manifest named `squeal`. Never throws: the daemon reads it after the store
 * opened (D12).
 */
describe("squealVersion", () => {
  it("is the root package version when run from the sources", () => {
    expect(squealVersion()).toBe(ROOT_VERSION);
  });

  it("walks up past manifests of other packages to the one named squeal", () => {
    const root = runtimeDir();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "squeal", version: "9.8.7" }));
    const plugin = join(root, "plugins/claude-code");
    mkdirSync(join(plugin, "dist/cli"), { recursive: true });
    writeFileSync(
      join(plugin, "package.json"),
      JSON.stringify({ name: "other", version: "1.0.0" }),
    );
    const module = pathToFileURL(join(plugin, "dist/cli/squeal.mjs"));
    expect(manifestVersion(module)).toBe("9.8.7");
  });

  it("is null without a squeal manifest above, and unreadable manifests are skipped", () => {
    // Under /tmp: the OS temp dir can sit inside a checkout of this repository.
    const root = runtimeDir();
    writeFileSync(join(root, "package.json"), "not json");
    mkdirSync(join(root, "a"));
    expect(manifestVersion(pathToFileURL(join(root, "a/x.js")))).toBeNull();
    expect(UNKNOWN_VERSION).toMatch(/unknown/);
  });
});

/*
 * Row 014-42: one reader of the installed versions, for `squeal setup`,
 * `squeal update` and `squeal ps` (D7 `older`), each with its own plugins
 * directory.
 */
describe("the installed versions", () => {
  const claude = (plugins: Record<string, unknown>) => {
    const dir = runtimeDir();
    writeFileSync(join(dir, "installed_plugins.json"), JSON.stringify({ version: 2, plugins }));
    return dir;
  };

  it("reads the squeal entries of one marketplace, a key of no string as null", () => {
    const dir = claude({
      "squeal@hearsay": [
        { scope: "user", version: "0.1.250", installPath: "/c/0.1.250" },
        { scope: "project", projectPath: 7, version: null },
        "not an entry",
      ],
      "squeal@squeal": [{ scope: "user", version: "0.1.100" }],
    });
    expect(claudeInstalls(dir, "hearsay")).toEqual([
      { scope: "user", projectPath: null, version: "0.1.250", installPath: "/c/0.1.250" },
      { scope: "project", projectPath: null, version: null, installPath: null },
    ]);
    expect(claudeInstalls(dir, "other")).toEqual([]);
    const broken = runtimeDir();
    writeFileSync(join(broken, "installed_plugins.json"), "not json");
    expect(claudeInstalls(broken, "hearsay")).toEqual([]);
    expect(claudeInstalls(join(broken, "missing"), "hearsay")).toEqual([]);
  });

  it("loads the first user entry, or the project entry of the root, that has a version", () => {
    const dir = claude({
      "squeal@hearsay": [
        { scope: "project", projectPath: "/elsewhere", version: "0.1.260" },
        { scope: "user" },
        { scope: "project", projectPath: "/repo", version: "0.1.255" },
        { scope: "user", version: "0.1.250" },
      ],
    });
    expect(claudeLoaded(dir, "hearsay", "/repo")).toEqual({ version: "0.1.255", scope: "project" });
    expect(claudeLoaded(dir, "hearsay", "/other")).toEqual({ version: "0.1.250", scope: "user" });
    expect(claudeLoaded(dir, "hearsay", null)).toEqual({ version: "0.1.250", scope: "user" });
    const projectOnly = claude({ "squeal@hearsay": [{ scope: "project", version: "0.1.255" }] });
    expect(claudeLoaded(projectOnly, "hearsay", null)).toBeNull();
  });

  it("takes the newest Codex cache version by its numbers, past names that are no version", () => {
    const plugins = runtimeDir();
    for (const name of ["latest", "0.1.9", "0.1.131", "0.1.12", "0.2", "0.3.0-beta", ".tmp"])
      mkdirSync(join(plugins, "cache", "hearsay", "squeal", name), { recursive: true });
    expect(codexNewest(plugins, "hearsay")).toBe("0.1.131");
    expect(codexNewest(plugins, "other")).toBeNull();
    const none = runtimeDir();
    mkdirSync(join(none, "cache", "hearsay", "squeal", "latest"), { recursive: true });
    expect(codexNewest(none, "hearsay")).toBeNull();
  });
});
