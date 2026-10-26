import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../../evals/lib/index.mjs";
import { main } from "../../../src/cli/main.js";
import { lintStorePath } from "../../../src/core/lint/store/index.js";
import { NOW, seed } from "../../status/slow-tier-seed.js";
import { deliveryOf, wiredRig } from "./rig.js";

/*
 * Spec 017 D8: status's lint line under the code lines and its `lint` JSON,
 * from the store the real pass wrote; nothing at all while lint is off.
 */

function status(cwd: string, args: string[] = [], env: Record<string, string> = {}) {
  let out = "";
  const code = main(["status", ...args], {
    stdout: (t) => {
      out += t;
    },
    stderr: () => {},
    cwd,
    env,
    now: () => NOW,
  });
  return { code, out };
}

const SESSION = { CLAUDE_CODE_SESSION_ID: "s1" };

describe("status's lint part (017 D8)", () => {
  it("counts the files with findings and those since this session started", async () => {
    const rig = await wiredRig({ "src/a.js": "bad no-undef\n", "src/b.js": "ok\n" });
    await deliveryOf(rig).register(rig.consumer("s1"));
    await rig.edit({ "src/b.js": "bad no-console\n" });
    const text = status(rig.repo.main, [], SESSION).out.split("\n");
    expect(text).toContain(
      "Lint: 2 files with findings, 1 since this session started; squeal lint lists them.",
    );
    const json = JSON.parse(status(rig.repo.main, ["--json"], SESSION).out);
    expect(json.lint).toEqual({
      v: 1,
      files: 2,
      failing: 2,
      sinceRegistration: 1,
      since: "session",
      pending: 0,
      stale: 0,
      unknown: 0,
      reasons: [],
    });
  });

  it("gives the evals the same evidence with its lint line as without it", async () => {
    const rig = await wiredRig({ "src/a.js": "bad no-undef\n" });
    const text = status(rig.repo.main).out;
    const without = text
      .split("\n")
      .filter((l) => !l.startsWith("Lint"))
      .join("\n");
    expect(text).not.toBe(without);
    expect(squealEvidence(text, "pull")).toEqual(squealEvidence(without, "pull"));
  });

  it("shows nothing of lint, and creates no lint store, while lint is off", () => {
    const s = seed({});
    const text = status(s.repo.main).out;
    expect(text).not.toMatch(/^Lint/m);
    expect(JSON.parse(status(s.repo.main, ["--json"]).out)).not.toHaveProperty("lint");
    expect(existsSync(lintStorePath(s.repo.commonDir))).toBe(false);
  });
});
