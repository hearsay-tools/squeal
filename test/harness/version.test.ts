import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { manifestVersion, squealVersion, UNKNOWN_VERSION } from "../../src/core/daemon/version.js";
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
