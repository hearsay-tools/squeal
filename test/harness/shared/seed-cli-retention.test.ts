import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_ENTRIES } from "../../../src/harness/codex/adapter/manifest.js";
import {
  keptCacheCli,
  keptCli,
  pruneVersions,
} from "../../../src/harness/shared/version-copies.js";
import {
  codexDataOf,
  writeCurrent,
  writeFixedPlugin,
  writePin,
  writeRuntime,
} from "../../cli/codex-runtime-fixture.js";
import { tempDir } from "../../store/helpers.js";

const launcher = "#!/bin/sh\n# squeal-launcher format 8\n";
const cliOf = (root: string) => join(root, "dist", "cli", "squeal.mjs");

describe("002-36: a CLI launched from the fixed plugin's seed", () => {
  it("retains the whole runtime before cache removal, without changing current or pins", () => {
    const codex = tempDir("squeal-seed-cli-");
    const data = codexDataOf(codex);
    const adapter = join(codex, "plugins", "cache", "hearsay", "squeal", "1.0.0");
    writeFixedPlugin(adapter, "1.0.0", "0.1.5", launcher);
    for (const version of ["0.1.1", "0.1.2", "0.1.6"]) {
      const root = join(data, "versions", version);
      writeRuntime(root, version, launcher);
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      utimesSync(root, old, old);
    }
    writeCurrent(data, "0.1.6");
    const pin = writePin(data, "session", "0.1.1");
    const before = readFileSync(pin, "utf8");
    const cli = keptCacheCli(cliOf(join(adapter, "seed")), "0.1.5", { CODEX_HOME: codex });
    const root = join(data, "versions", "0.1.5");
    expect(cli).toBe(cliOf(root));
    for (const entry of [...REQUIRED_ENTRIES, "runtime.json"]) {
      expect(readFileSync(join(root, entry))).toEqual(readFileSync(join(adapter, "seed", entry)));
    }
    expect(keptCli(data, "0.1.5")).toBe(cli);
    expect(readFileSync(pin, "utf8")).toBe(before);
    expect(JSON.parse(readFileSync(join(data, "runtime", "current.json"), "utf8"))).toEqual({
      schema: 1,
      version: "0.1.6",
    });
    rmSync(adapter, { recursive: true });
    const child = spawnSync(process.execPath, [cli, "start"], { encoding: "utf8" });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toMatchObject({ version: "0.1.5", cli, args: ["start"] });
    pruneVersions(data, "0.1.5");
    expect(existsSync(join(data, "versions", "0.1.1"))).toBe(true);
    expect(existsSync(join(data, "versions", "0.1.2"))).toBe(false);
  });
});
