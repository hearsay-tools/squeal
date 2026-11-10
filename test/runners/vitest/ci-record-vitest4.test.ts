import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ciCommand } from "../../../src/cli/ci.js";
import { type Part, readPart } from "../../../src/core/ci/parts.js";
import { TS_WORKER } from "../../code/coverage/payloads.js";
import { SLOW } from "./helpers.js";

/*
 * Spec 018 D8, row 018-26: `squeal ci record` around a project on Vitest 4.1,
 * whose `vitest/node` exports no `Logger` and no `Vitest` class at run time
 * (cezar merge-group run 42799552999: no shard recorded). The stub package
 * `vitest-4.1/vitest` has that shape; the hook finds the class in the chunk
 * `vitest/node` imports it from. The stub has no `configOverride`, so Squeal's
 * coverage provider cannot be added (spec 020 D13): the part says so, and the
 * run is as before.
 */

const FIXTURE = resolve(import.meta.dirname, "../../fixtures/vitest/vitest-4.1");

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The fixture project with the stub as its `vitest`, committed in a repository of its own. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), "squeal-vitest41-"));
  temps.push(root);
  cpSync(join(FIXTURE, "project"), root, { recursive: true });
  cpSync(join(FIXTURE, "vitest"), join(root, "node_modules/vitest"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "f"], {
    cwd: root,
  });
  return root;
}

async function record(root: string): Promise<{ exit: number; text: string; parts: Part[] }> {
  const out = join(root, "parts");
  let text = "";
  const add = (chunk: string) => {
    text += chunk;
  };
  const command = [process.execPath, join(root, "node_modules/vitest/vitest.mjs"), "run"];
  const exit = await ciCommand(
    ["record", "--out", out, "--", ...command],
    { stdout: add, stderr: add, cwd: root, env: process.env },
    { mapWorker: TS_WORKER },
  );
  const names = text.includes("wrote ") ? readdirSync(out) : [];
  const parts = names.map((name) => {
    const part = readPart(join(out, name));
    if (typeof part === "string") throw new Error(part);
    return part;
  });
  return { exit, text, parts };
}

describe("squeal ci record on Vitest 4.1", () => {
  it("writes a part with the run's outcomes and exits with the command's code", SLOW, async () => {
    const run = await record(project());

    expect(run.exit).toBe(1);
    expect(run.text).not.toContain("could not record");
    expect(run.parts).toHaveLength(1);
    const part = run.parts[0] as Part;
    expect(part.header).toMatchObject({
      runner: "vitest",
      runnerVersion: "4.1.10",
      shard: { index: 1, count: 1 },
      end: "completed",
      dirty: false,
      coverage: { off: "failed", note: "the Vitest instance has no configOverride" },
    });
    expect(part.coverage).toBeUndefined();
    expect(part.testFiles.map((f) => [f.record, f.noRecord])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
    expect(run.text).toContain(
      "no coverage records: Squeal's provider failed: the Vitest instance has no configOverride",
    );
    expect(part.projects.map((p) => [p.descriptor.runnerVersion, p.updateSnapshot])).toEqual([
      ["4.1.10", "none"],
    ]);
    expect(
      part.testFiles.map((f) => [f.path, f.outcome, f.checks.map((c) => [c.fullName, c.outcome])]),
    ).toEqual([
      ["test/fails.test.js", "fail", [["fails", "fail"]]],
      [
        "test/passes.test.js",
        "pass",
        [
          ["reads", "pass"],
          ["waits", "skip"],
        ],
      ],
    ]);
  });

  it("notes a Vitest it cannot attach to and runs the command unchanged", SLOW, async () => {
    const root = project();
    // A `vitest/node` that leads to no `Vitest` class: nothing to wrap.
    writeFileSync(
      join(root, "node_modules/vitest/lib/node.js"),
      'export const version = "4.1.10";\n',
    );

    const run = await record(root);

    expect(run.exit).toBe(1);
    expect(run.text).toMatch(
      /Vitest process \d+: could not record \(vitest\/node imports no Vitest class with start\); no part/,
    );
    expect(run.parts).toEqual([]);
  });
});
