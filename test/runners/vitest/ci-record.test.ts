import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ciCommand } from "../../../src/cli/ci.js";
import { readPart } from "../../../src/core/ci/parts.js";
import { coreEnvironmentInputs } from "../../../src/core/keys/environment.js";
import { describeEnvironment } from "../../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../../src/core/keys/key-format.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, SLOW } from "./helpers.js";

/*
 * Spec 018 D8 and D9, row 018-16: a part's descriptor is the run's own, and
 * the export job compares it with the one it computes as the daemon does
 * (D10). On the same project and environment, the config fields differ only
 * where Squeal's instance sets its own options (`adapter.ts` `#start`).
 */

const VITEST = resolve(import.meta.dirname, "../../../node_modules/vitest/vitest.mjs");

/** The fields the daemon's instance sets itself: `includeTaskLocation: true` and `update: "none"`. */
const SQUEAL_OPTIONS = ["includeTaskLocation", "snapshotOptions"];

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("a part's descriptor beside the daemon's", () => {
  it("differs in config only where Squeal's instance sets its own options", SLOW, async () => {
    const fixture = await openFixture("basic", {}, (root) =>
      createVitestAdapter({ root, observe: () => true }),
    );
    execFileSync("git", ["init", "-q"], { cwd: fixture.root });
    const environments = await fixture.adapter.environment();
    const core = coreEnvironmentInputs({
      squealVersion: "0.0.0",
      installedDependencies: "none",
      allowlist: [],
    });
    const daemon = describeEnvironment(
      KEY_FORMAT_VERSION,
      core,
      environments[0] as never,
      [],
      false,
    );

    const out = mkdtempSync(join(tmpdir(), "squeal-ci-parts-"));
    temps.push(out);
    const io = { stdout: () => {}, stderr: () => {}, cwd: fixture.root, env: process.env };
    const exit = await ciCommand(
      ["record", "--out", out, "--", process.execPath, VITEST, "run"],
      io,
    );
    expect(exit).toBe(0);
    const [name] = readdirSync(out);
    const part = readPart(join(out, name as string));
    if (typeof part === "string") throw new Error(part);
    const run = part.projects[0]?.descriptor;

    expect(run?.project).toBe(daemon.project);
    expect(run?.adapterVersion).toBe(daemon.adapterVersion);
    expect(run?.runnerVersion).toBe(daemon.runnerVersion);
    const fields = new Set([...Object.keys(daemon.config), ...Object.keys(run?.config ?? {})]);
    const differing = [...fields].filter((field) => daemon.config[field] !== run?.config[field]);
    expect(differing.filter((field) => !SQUEAL_OPTIONS.includes(field))).toEqual([]);
    expect(differing).toContain("includeTaskLocation");
  });
});
