import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHarnesses } from "../../src/cli/setup/harnesses.js";
import { codexRuntimeVersion } from "../../src/core/daemon/codex-runtime-version.js";
import { codexNewest } from "../../src/core/daemon/version.js";
import {
  codexDataOf,
  writeCurrent,
  writeFixedPlugin,
  writeRuntime,
} from "../cli/codex-runtime-fixture.js";
import { tempDir } from "../store/helpers.js";

const launcher = "#!/bin/sh\n# squeal-launcher format 8\n";

function fixture() {
  const home = tempDir("squeal-identity-");
  const codex = join(home, ".codex");
  const plugins = join(codex, "plugins");
  const root = join(plugins, "cache", "hearsay", "squeal", "1.0.0");
  const data = codexDataOf(codex);
  writeFixedPlugin(root, "1.0.0", "0.1.5", launcher);
  return { home, plugins, root, data };
}

describe("002-36: installed Codex runtime identity", () => {
  it("reports the seed runtime while setup still discovers the fixed adapter", () => {
    const { home, plugins, data } = fixture();
    expect(codexRuntimeVersion(plugins, "hearsay")).toBe("0.1.5");
    expect(codexNewest(plugins, "hearsay")).toBe("1.0.0");
    expect(readHarnesses("/repo", { HOME: home }).find((h) => h.id === "codex")?.plugin).toEqual({
      version: "1.0.0",
      scope: "user",
    });
    expect(existsSync(data)).toBe(false);
  });

  it("reports the selected runtime, or a newer seed, without selecting either", () => {
    const { plugins, data } = fixture();
    for (const version of ["0.1.4", "0.1.6", "0.1.99"])
      writeRuntime(join(data, "versions", version), version, launcher);
    writeCurrent(data, "0.1.6");
    expect(codexRuntimeVersion(plugins, "hearsay")).toBe("0.1.6");
    writeCurrent(data, "0.1.4");
    const before = readFileSync(join(data, "runtime", "current.json"), "utf8");
    expect(codexRuntimeVersion(plugins, "hearsay")).toBe("0.1.5");
    // An unselected retained release does not decide what a new session runs.
    expect(codexRuntimeVersion(plugins, "hearsay")).not.toBe("0.1.99");
    expect(readFileSync(join(data, "runtime", "current.json"), "utf8")).toBe(before);
  });

  it("never reports the adapter as a runtime when current and seed are unusable", () => {
    const { plugins, data, root } = fixture();
    writeCurrent(data, "0.1.6");
    expect(codexRuntimeVersion(plugins, "hearsay")).toBe("0.1.5");
    rmSync(join(root, "seed"), { recursive: true });
    expect(codexRuntimeVersion(plugins, "hearsay")).toBeNull();
  });

  it("preserves legacy Codex discovery and Claude Code's setup version", () => {
    const home = tempDir("squeal-legacy-identity-");
    const plugins = join(home, ".codex", "plugins");
    mkdirSync(join(plugins, "cache", "hearsay", "squeal", "0.1.9"), { recursive: true });
    mkdirSync(join(plugins, "cache", "hearsay", "squeal", "0.1.10"), { recursive: true });
    expect(codexRuntimeVersion(plugins, "hearsay")).toBe("0.1.10");
    expect(codexRuntimeVersion(plugins, "missing")).toBeNull();
    const claude = join(home, ".claude", "plugins");
    mkdirSync(claude, { recursive: true });
    writeFileSync(
      join(claude, "installed_plugins.json"),
      JSON.stringify({
        plugins: { "squeal@hearsay": [{ scope: "user", version: "0.1.11" }] },
      }),
    );
    expect(readHarnesses("/repo", { HOME: home }).map((h) => h.plugin?.version)).toEqual([
      "0.1.11",
      "0.1.10",
    ]);
  });
});
