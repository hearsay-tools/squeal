import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { antigravityCommand } from "../../../src/harness/antigravity/command.js";

/*
 * Spec 024 D1 (row 024-02): an Antigravity hook's texts name
 * `$PLUGIN_DATA/bin/squeal` once it exists, else the installed CLI by path.
 */

const NODE = "node --disable-warning=ExperimentalWarning";
const ROOT = "/opt/u/.gemini/config/plugins/squeal";

describe("antigravityCommand", () => {
  it("names the CLI under PLUGIN_ROOT before the launcher exists", () => {
    const env = { PLUGIN_ROOT: ROOT, PLUGIN_DATA: "/nowhere/plugin_data/squeal" };
    expect(antigravityCommand(env, "/elsewhere/dist/cli/squeal.mjs")).toBe(
      `${NODE} ${ROOT}/dist/cli/squeal.mjs`,
    );
  });

  it("names the running bundle's sibling CLI without PLUGIN_ROOT, as for a workspace plugin", () => {
    expect(antigravityCommand({}, "/p/dist/cli/squeal.mjs")).toBe(`${NODE} /p/dist/cli/squeal.mjs`);
    expect(antigravityCommand({ PLUGIN_ROOT: "" }, "/p/dist/cli/squeal.mjs")).toBe(
      `${NODE} /p/dist/cli/squeal.mjs`,
    );
  });

  it("names the launcher in PLUGIN_DATA once it exists, or beside the copy it runs from", () => {
    const data = join(mkdtempSync("/tmp/sq-agy-data-"), "squeal");
    const copy = join(data, "versions", "0.1.600", "dist", "cli", "squeal.mjs");
    const env = { PLUGIN_ROOT: ROOT, PLUGIN_DATA: data };
    expect(antigravityCommand(env, copy)).toBe(`${NODE} ${ROOT}/dist/cli/squeal.mjs`);
    mkdirSync(join(data, "bin"), { recursive: true });
    writeFileSync(join(data, "bin", "squeal"), "");
    expect(antigravityCommand(env, copy)).toBe(`${data}/bin/squeal`);
    // A CLI the launcher ran from the copy, in a shell without PLUGIN_DATA.
    expect(antigravityCommand({}, copy)).toBe(`${data}/bin/squeal`);
    rmSync(join(data, ".."), { recursive: true, force: true });
  });

  it("single-quotes a path the shell would not read back bare", () => {
    expect(antigravityCommand({ PLUGIN_ROOT: "/a $b" }, "/x")).toBe(
      `${NODE} '/a $b/dist/cli/squeal.mjs'`,
    );
  });
});
