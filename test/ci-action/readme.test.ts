import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPolicy } from "../../src/core/daemon/policy.js";
import { NODE_PATH, REPO, scratch } from "./checkout.js";

/*
 * Spec 018 D20.3, row 018-33 item 3: the README's "Results from CI" shows
 * the whole setup. These tests hold its workflow to what the action needs:
 * the action after setup-node in each job, push rights only in the export
 * job, downloads that cannot fail on a missing artifact, a `shared.ref`
 * Squeal reads, and `squeal` lines this repository's wrapper accepts.
 */

const README = readFileSync(join(REPO, "README.md"), "utf8");

/** The README's section, from its heading to the next `## ` heading. */
function section(): string {
  const start = README.indexOf("\n## Results from CI\n");
  expect(start).toBeGreaterThan(-1);
  const end = README.indexOf("\n## ", start + 1);
  return README.slice(start, end === -1 ? undefined : end);
}

/** The section's fenced blocks in `language`, as text. */
function blocks(language: string): string[] {
  const fence = new RegExp(`^ *\`\`\`${language}\\n([\\s\\S]*?)^ *\`\`\``, "gm");
  return [...section().matchAll(fence)].map((m) => m[1] ?? "");
}

/** The workflow's jobs, by name, each as its text. */
function jobs(): Record<string, string> {
  const [workflow] = blocks("yaml");
  expect(workflow).toBeDefined();
  const body = (workflow ?? "").split("\njobs:\n")[1] ?? "";
  return Object.fromEntries(
    body.split(/^(?= {2}\S)/m).map((job) => [job.trim().split(":")[0] ?? "", job]),
  );
}

describe("the README's CI setup", () => {
  it("reads contents in every job but the export, and runs the action after setup-node", () => {
    const [workflow] = blocks("yaml");
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m);
    const { test, "squeal-export": exported } = jobs();
    expect(test).not.toContain("contents: write");
    expect(exported).toContain("permissions:\n      contents: write\n");
    expect(exported).toContain("needs: test\n");
    for (const job of [test ?? "", exported ?? ""]) {
      const node = job.indexOf("uses: actions/setup-node@");
      expect(node).toBeGreaterThan(-1);
      expect(job.indexOf("uses: hearsay-tools/squeal/ci@v0\n")).toBeGreaterThan(node);
    }
    // A named artifact that is missing fails the step; a pattern that matches none does not.
    expect(exported).toMatch(/download-artifact@v\d+\n {8}with:\n {10}pattern: /);
    expect(exported).not.toMatch(/download-artifact@v\d+\n {8}with:\n {10}name: /);
  });

  it("sets a shared.ref that Squeal reads", () => {
    const [config] = blocks("json").filter((block) => block.includes('"shared"'));
    const dir = scratch("readme-policy");
    writeFileSync(join(dir, "squeal.config.json"), config ?? "");
    expect(readPolicy(dir).shared.ref).toBe("refs/squeal");
  });

  it("has squeal lines that this repository's squeal accepts", () => {
    const lines = blocks("yaml")
      .join("\n")
      .split("\n")
      .flatMap((line) => /^ *- run: (squeal .+)$/.exec(line)?.[1] ?? []);
    expect(lines.map((line) => line.split(" ").slice(0, 3).join(" "))).toEqual([
      "squeal ci record",
      "squeal ci export",
      "squeal ci publish",
    ]);
    const temp = scratch("readme-runner-temp");
    for (const line of lines) {
      // Record runs `true` in place of the tests; outside a git worktree each command refuses
      // or runs unchanged, and only a usage error (exit 2) would fail.
      const script = line.replace(/ -- .*$/, " -- true").replace(/\$\{\{ matrix\.shard \}\}/g, "1");
      const run = spawnSync("sh", ["-c", script], {
        cwd: temp,
        encoding: "utf8",
        env: {
          PATH: `${join(REPO, "ci/bin")}:${NODE_PATH}`,
          HOME: temp,
          RUNNER_TEMP: temp,
        },
      });
      expect({ line, code: run.status, usage: run.stderr.includes("usage:") }).toEqual({
        line,
        code: 0,
        usage: false,
      });
    }
  });
});
