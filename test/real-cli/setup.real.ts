import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, runCount, type Shape } from "./fixtures.js";
import { type Machine, machine, ok } from "./machine.js";
import { calm, shown } from "./state.js";

/*
 * Spec 005 Testing, end to end, bullet 4, on fixtures shaped like this
 * repository and like cezarion: `squeal setup --yes` with every choice writes
 * what the plan says, its warm-up leaves every test file current, a first
 * session runs nothing more, and a second setup reports nothing outdated.
 * One machine with both harnesses installed by `install.sh` serves the file.
 * Bullet 3, setup's artifact proposals, went with them (task 004-81).
 */

let m: Machine;
beforeAll(async () => {
  m = await machine(["claude", "codex"]);
  ok(await m.install(), "install.sh");
});
afterAll(() => m.dispose());

interface Plan {
  readonly gates: readonly {
    readonly id: string;
    readonly text: string;
    readonly proposed: string | null;
  }[];
  readonly outdated: readonly string[];
}

const plan = async (fx: string): Promise<Plan> =>
  JSON.parse(ok(await m.squeal(["setup", "--plan", "--json"], fx), "setup --plan").stdout) as Plan;

/** Every choice of each shape, as flags: the plan's defaults, and the input the spec names. */
const CHOICES: Readonly<
  Record<Shape, { flags: string[]; block: string; slow: string; input: [string, string] }>
> = {
  squeal: {
    flags: ["--gate", "CLAUDE.md:3=reword"],
    block: "CLAUDE.md",
    slow: "test/e2e/**",
    input: ["test/e2e/**", "plugins/**"],
  },
  cezarion: {
    flags: [],
    block: "AGENTS.md",
    slow: "packages/cezar/test/e2e/**",
    input: ["packages/cezar/test/e2e/**", "packages/cezar/dist/**"],
  },
};

interface Status {
  readonly counts: Readonly<Record<string, number>>;
  readonly testFilesWithoutChecks: Readonly<Record<string, number>>;
  readonly fullSuite: { readonly atCurrentRevision: boolean };
  readonly slowTier?: { readonly pending: number; readonly notRun: number };
}

const status = async (fx: string): Promise<Status> =>
  JSON.parse(ok(await m.squeal(["status", "--json"], fx), "status --json").stdout) as Status;

/** The installed plugins' SessionStart hooks, run as each harness runs them at a session's start. */
async function startSessions(fx: string): Promise<void> {
  const installed = JSON.parse(
    (await m.read(`${m.claudeConfig}/plugins/installed_plugins.json`)) ?? "{}",
  ) as { plugins: Record<string, { installPath: string }[]> };
  const claude = installed.plugins["squeal@hearsay"]?.[0]?.installPath as string;
  const id = randomUUID();
  const input = (transcript: string) =>
    JSON.stringify({
      session_id: id,
      transcript_path: transcript,
      cwd: fx,
      hook_event_name: "SessionStart",
      source: "startup",
      model: "claude-sonnet-5-5",
    });
  ok(
    await m.run(
      "node",
      ["--disable-warning=ExperimentalWarning", `${claude}/dist/session-start.mjs`],
      {
        cwd: fx,
        input: input(`${m.home}/.claude/projects/fx/${id}.jsonl`),
        env: { CLAUDE_PLUGIN_ROOT: claude, CLAUDE_PROJECT_DIR: fx },
      },
    ),
    "Claude Code SessionStart",
  );
  const codex = (
    await m.sh('ls -d "$1"/*', [`${m.codexHome}/plugins/cache/hearsay/squeal`])
  ).stdout.trim();
  ok(
    await m.sh(
      'exec node --disable-warning=ExperimentalWarning "$PLUGIN_ROOT/dist/session-start.mjs"',
      [],
      {
        cwd: fx,
        input: input(`${m.codexHome}/sessions/rollout-${id}.jsonl`),
        env: { PLUGIN_ROOT: codex, PWD: fx },
      },
    ),
    "Codex SessionStart",
  );
}

describe.each(["squeal", "cezarion"] as const)(
  "squeal setup --yes on the %s shape (bullet 4)",
  (shape) => {
    it("writes what the plan says, warms every file up, and leaves nothing for a session or a second setup", async () => {
      const fx = await fixture(m, shape);
      const c = CHOICES[shape];
      const before = await plan(fx);
      const head = (await m.sh("git rev-parse HEAD", [], { cwd: fx })).stdout.trim();
      const { load, cpus } = await calm();
      console.log(`${shape}: setup --yes at load ${load.toFixed(1)} on ${cpus} CPUs`);
      const r = await m.squeal(
        [
          "setup",
          "--yes",
          "--harness",
          "claude-code",
          "--harness",
          "codex",
          "--block",
          c.block,
          ...c.flags,
          "--slow",
          c.slow,
          "--input",
          `${c.input[0]}=${c.input[1]}`,
        ],
        fx,
        { timeoutMs: 900_000 },
      );
      expect(r.status, shown(r)).toBe(0);
      expect(r.stdout).toContain("Commit these when they look right; squeal setup never commits");

      // The files written match the plan.
      expect((await m.sh("git rev-parse HEAD", [], { cwd: fx })).stdout.trim()).toBe(head);
      const block = (await m.read(`${fx}/${c.block}`)) ?? "";
      expect(block).toMatch(/<!-- squeal:begin v\d+ [^\n]*-->[\s\S]*<!-- squeal:end -->/);
      // A gate is reworded only on its own `--gate <id>=reword`; --yes keeps the rest (D5).
      for (const gate of before.gates) {
        const reworded = c.flags.includes(`${gate.id}=reword`);
        expect(block).toContain(reworded ? (gate.proposed as string) : gate.text);
      }
      const config = JSON.parse((await m.read(`${fx}/squeal.config.json`)) ?? "{}") as {
        slow?: { include?: string[] };
        inputs?: Record<string, string[]>;
      };
      expect(config.slow?.include).toContain(c.slow);
      expect(config.inputs?.[c.input[0]]).toContain(c.input[1]);
      const settings = JSON.parse((await m.read(`${fx}/.claude/settings.json`)) ?? "{}") as {
        enabledPlugins?: Record<string, boolean>;
      };
      expect(settings.enabledPlugins?.["squeal@hearsay"]).toBe(true);
      const changed = (
        await m.sh("git status --porcelain --untracked-files=all | grep -v ' node_modules$'", [], {
          cwd: fx,
        })
      ).stdout;
      expect(
        changed
          .split("\n")
          .filter(Boolean)
          .map((l) => l.slice(3))
          .sort(),
      ).toEqual([c.block, ".claude/settings.json", "squeal.config.json"].sort());

      // The warm-up leaves every test file current.
      const warm = await status(fx);
      expect(warm.counts.pending).toBe(0);
      expect(warm.counts.stale).toBe(0);
      expect(warm.counts.unknown).toBe(0);
      expect(Object.values(warm.testFilesWithoutChecks).every((n) => n === 0)).toBe(true);
      expect(warm.slowTier?.pending ?? 0).toBe(0);
      expect(warm.slowTier?.notRun ?? 0).toBe(0);

      // A first session runs nothing more.
      const runs = await runCount(m, fx);
      await startSessions(fx);
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      expect(await runCount(m, fx)).toBe(runs);
      const after = await status(fx);
      expect([after.counts.pending, after.counts.stale, after.counts.unknown]).toEqual([0, 0, 0]);

      // A second setup, once the user has committed what the first named, reports nothing outdated.
      const listed = r.stdout
        .slice(r.stdout.indexOf("squeal setup never commits:"))
        .split("\n")
        .slice(1)
        .filter((line) => /^ {2}\S/.test(line))
        .map((line) => line.trim());
      expect(listed.sort()).toEqual(
        [c.block, ".claude/settings.json", "squeal.config.json"].sort(),
      );
      ok(
        await m.sh('git add -- "$@" && git commit -qm "squeal setup"', listed, { cwd: fx }),
        "commit what setup named",
      );
      const check = await m.squeal(["setup", "--check"], fx);
      expect(check.status, shown(check)).toBe(0);
      expect((await plan(fx)).outdated).toEqual([]);
    });
  },
);
