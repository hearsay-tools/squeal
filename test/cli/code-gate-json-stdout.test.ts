import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { BASE, edit, repo } from "./code-gate-fixture.js";

/*
 * Spec 020 D14.4 (row 020-15b, #182, from `research/issue-182.md`'s
 * probe): with `--json`, stdout holds the report alone, even when a global
 * setup writes to stdout in the gate's process and through a process it
 * starts with `stdio: "inherit"`. That output goes to stderr, after the
 * selection line. The real CLI entry runs in a process of its own, through
 * tsx, so the gate's own child is a real relaunch.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

const SETUP = [
  'import { execFileSync } from "node:child_process";',
  "",
  "export default function setup() {",
  '  console.log("SETUP_IN_PROCESS");',
  '  execFileSync(process.execPath, ["-e", "console.log(\'SETUP_CHILD\')"], { stdio: "inherit" });',
  "}",
  "",
].join("\n");

/** The CLI at `cwd` in a process of its own, with a HOME of its own and no daemon. */
function cli(args: readonly string[], cwd: string) {
  const home = mkdtempSync(join(tmpdir(), "squeal-gate-home-"));
  homes.push(home);
  const env = { PATH: process.env.PATH ?? "", HOME: home };
  const flags = ["--disable-warning=ExperimentalWarning", "--import", TSX, CLI];
  const child = spawn(process.execPath, [...flags, ...args], { cwd, env });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (text: string) => {
    stdout += text;
  });
  child.stderr.setEncoding("utf8").on("data", (text: string) => {
    stderr += text;
  });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

describe("squeal code --base --json: stdout is the report alone (spec 020 D14.4, #182)", () => {
  // Two CLI processes compile the source through tsx, then a real Vitest run.
  it("sends a global setup's stdout, its own and an inheriting child's, to stderr", {
    timeout: 180_000,
  }, async () => {
    const root = repo({
      ...BASE,
      "vitest.config.ts": `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], globalSetup: ["./setup.ts"] } });\n`,
      "setup.ts": SETUP,
    });
    edit(root, {
      "src/math.ts": "export function double(x: number): number {\n  return x + x;\n}\n",
    });

    const ran = await cli(["code", "--base", "main", "--json"], root);

    expect(ran.stderr).toContain("SETUP_IN_PROCESS\n");
    expect(ran.stderr).toContain("SETUP_CHILD\n");
    const report = JSON.parse(ran.stdout) as GateReport;
    expect(report.format).toBe("squeal-code-gate/1");
    expect(report.verdict).toBe("pass");
    expect(ran.code).toBe(0);
    const selection = ran.stderr.indexOf("squeal code: Vitest: 1 test file to run (tests 1)\n");
    const setup = "squeal code: global setup runs for: the root project (any selection)\n";
    expect(selection).toBeGreaterThanOrEqual(0);
    expect(ran.stderr.indexOf(setup)).toBeGreaterThan(selection);
    expect(ran.stderr.indexOf("SETUP_IN_PROCESS")).toBeGreaterThan(ran.stderr.indexOf(setup));
  });
});
