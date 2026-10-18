import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import type { SetupPlan } from "../../../src/cli/setup/plan.js";
import { capture, cleanupFixtures, json, squealShaped } from "./fixture.js";

/*
 * Row 004-68, spec 004 D7 as amended 2026-10-17: a command precondition is
 * code Squeal runs beside the runner, so `squeal setup --plan` and `--check`
 * name it, with its argv and timeout, as visibly as `nodeTest[].argv`.
 */

afterEach(cleanupFixtures);

const SLOW = { include: ["test/e2e/**/*.test.ts"] };

/** A config `--check` finds nothing outdated in; a `nodeTest` project gets its file and inputs. */
function shaped(config: Record<string, unknown>): string {
  const node = "nodeTest" in config ? { "test/node/*.test.mjs": ["dist/**"] } : {};
  return squealShaped({
    "squeal.config.json": json({
      inputs: { "test/e2e/*.test.ts": ["plugins/**"], ...node },
      ...config,
    }),
    "test/node/smoke.test.mjs": "\n",
  });
}

async function check(root: string, json: boolean) {
  const { io, out } = capture(root);
  const code = await main(["setup", "--check", ...(json ? ["--json"] : [])], io);
  return { code, stdout: out.stdout };
}

async function plan(root: string): Promise<SetupPlan> {
  return JSON.parse((await check(root, true)).stdout) as SetupPlan;
}

describe("squeal setup lists declared precondition commands", () => {
  it("names slow.precondition's command with its argv and default timeout", async () => {
    const root = shaped({
      slow: {
        ...SLOW,
        precondition: { exists: ["dist/index.js"], command: ["node", "scripts/check dist.mjs"] },
      },
    });
    expect((await plan(root)).preconditions).toEqual([
      {
        source: "slow.precondition",
        command: ["node", "scripts/check dist.mjs"],
        timeoutMs: 10000,
      },
    ]);
    const { code, stdout } = await check(root, false);
    // A declared command is a fact, not a finding: --check counts nothing outdated for it.
    expect(code).toBe(0);
    expect(stdout).toContain(
      'Precondition commands (run before the slow tier):\n  slow.precondition.command: node "scripts/check dist.mjs", timeout 10000 ms\n',
    );
    expect(stdout).toContain("Nothing is outdated.");
    const { io, out } = capture(root);
    expect(await main(["setup", "--plan"], io)).toBe(0);
    expect(out.stdout).toContain("  slow.precondition.command: node");
  });

  it("names a node:test project's own command beside the global one", async () => {
    const root = shaped({
      slow: { ...SLOW, precondition: { command: ["test", "-d", "dist"], timeoutMs: 2000 } },
      nodeTest: [
        {
          name: "smoke",
          include: ["test/node/*.test.mjs"],
          slow: true,
          precondition: { command: ["sh", "scripts/ready.sh"], timeoutMs: 30000 },
        },
      ],
    });
    expect((await plan(root)).preconditions).toEqual([
      { source: "slow.precondition", command: ["test", "-d", "dist"], timeoutMs: 2000 },
      {
        source: 'nodeTest "smoke" precondition',
        command: ["sh", "scripts/ready.sh"],
        timeoutMs: 30000,
      },
    ]);
    const { code, stdout } = await check(root, false);
    expect(code).toBe(0);
    expect(stdout).toContain(
      [
        "Precondition commands (run before the slow tier):",
        "  slow.precondition.command: test -d dist, timeout 2000 ms",
        '  nodeTest "smoke" precondition.command: sh scripts/ready.sh, timeout 30000 ms',
      ].join("\n"),
    );
  });

  it("lists nothing for an exists-only precondition, global or a project's own", async () => {
    const root = shaped({
      slow: { ...SLOW, precondition: { exists: ["dist/index.js"] } },
      nodeTest: [
        {
          name: "smoke",
          include: ["test/node/*.test.mjs"],
          slow: true,
          precondition: { exists: ["dist/**"] },
        },
      ],
    });
    expect((await plan(root)).preconditions).toEqual([]);
    const { code, stdout } = await check(root, false);
    expect(code).toBe(0);
    expect(stdout).not.toContain("Precondition");
  });

  it("lists nothing when no precondition is declared", async () => {
    const root = shaped({ slow: SLOW });
    expect((await plan(root)).preconditions).toEqual([]);
    const { code, stdout } = await check(root, false);
    expect(code).toBe(0);
    expect(stdout).not.toContain("Precondition");
  });
});
