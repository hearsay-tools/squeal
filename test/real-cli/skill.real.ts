import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexConfig, providerVariables, redact, secretsOf } from "../../evals/lib/index.mjs";
import { fixture, type Shape } from "./fixtures.js";
import { type HarnessCli, type Machine, machine, ok } from "./machine.js";
import { calm, shown } from "./state.js";

/*
 * Spec 005 Testing, end to end, bullet 5: the setup skill in `claude -p`
 * (Sonnet 5.5) and `codex exec` (gpt-6-luna) with the answers given in the
 * prompt, one session per fixture shape and harness. Each costs model calls,
 * so it runs only with `SQ_REAL_CLI_MODELS=1`, and only while the one-minute
 * load is below the CPU count. The credentials pass by name only
 * (`--preserve-env`); the Codex provider's allow-listed fields are written
 * into the case's CODEX_HOME by `codexConfig`, never a key. Each session's
 * output, redacted, is kept under `SQ_REAL_CLI_OUT` (default
 * `/tmp/sq-rc-out`), outside every repository.
 */

const MODELS = process.env.SQ_REAL_CLI_MODELS === "1";
const OUT = process.env.SQ_REAL_CLI_OUT ?? "/tmp/sq-rc-out";
const REAL_CODEX_CONFIG = MODELS ? readFileSync(join(homedir(), ".codex/config.toml"), "utf8") : "";
const SECRETS = secretsOf(process.env, REAL_CODEX_CONFIG);

let current: Machine | null = null;
afterEach(async () => {
  await current?.dispose();
  current = null;
});

/** What the user answers, in the prompt, so the skill applies without asking. */
const ANSWERS: Readonly<Record<Shape, string>> = {
  squeal:
    "set up both Claude Code and Codex here; write the Squeal block to CLAUDE.md; reword gate line CLAUDE.md:3; run test/e2e in the slow tier and re-run it when plugins/** changes; have Codex trust the plugin's hooks; no warm-up; no launcher.",
  cezarion:
    "set up both Claude Code and Codex here; write the Squeal block to AGENTS.md; run packages/cezar/test/e2e in the slow tier and re-run it when packages/cezar/dist/** changes; packages/cezar/test/unit is not slow; have Codex trust the plugin's hooks; no warm-up; no launcher.",
};

const EXPECTED: Readonly<
  Record<Shape, { block: string; slow: string; input: string; gate: string | null }>
> = {
  squeal: {
    block: "CLAUDE.md",
    slow: "test/e2e/**",
    input: "plugins/",
    gate: "squeal run --all --wait",
  },
  cezarion: {
    block: "AGENTS.md",
    slow: "packages/cezar/test/e2e/**",
    input: "packages/cezar/dist/",
    gate: null,
  },
};

const invocation: Readonly<Record<HarnessCli, string>> = {
  claude: "/squeal:setup",
  codex: "$squeal:setup",
};

function session(harness: HarnessCli, prompt: string): [string, string[]] {
  if (harness === "claude")
    return [
      "claude",
      [
        "-p",
        prompt,
        "--model",
        "claude-sonnet-5-5",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
      ],
    ];
  return [
    "codex",
    [
      "exec",
      "--json",
      "-s",
      "danger-full-access",
      "--skip-git-repo-check",
      "-m",
      "gpt-6-luna",
      prompt,
    ],
  ];
}

const CASES = (["squeal", "cezarion"] as const).flatMap((shape) =>
  (["claude", "codex"] as const).map((harness) => ({ shape, harness })),
);

describe.skipIf(!MODELS).each(CASES)(
  "the setup skill, $harness on the $shape shape",
  ({ shape, harness }) => {
    it("applies the answers the prompt gives, shows the diff, and commits nothing", async () => {
      const m = await machine(["claude", "codex"]);
      current = m;
      const preserve = providerVariables(harness, process.env, REAL_CODEX_CONFIG);
      if (harness === "codex")
        ok(
          await m.run("tee", [`${m.codexHome}/config.toml`], {
            input: codexConfig(REAL_CODEX_CONFIG, "gpt-6-luna"),
          }),
          "write the Codex provider config",
        );
      ok(await m.install(), "install.sh");
      const fx = await fixture(m, shape);
      const head = (await m.sh("git rev-parse HEAD", [], { cwd: fx })).stdout.trim();

      const { load, cpus } = await calm(30 * 60_000);
      if (load >= cpus)
        throw new Error(`load ${load} stayed at or above ${cpus} CPUs: not started`);
      const prompt = `${invocation[harness]}\n\nMy answers to every setup question, so do not ask them: ${ANSWERS[shape]}`;
      const [cmd, args] = session(harness, prompt);
      const started = new Date().toISOString();
      const raw = await m.run(cmd, args, { cwd: fx, preserve, timeoutMs: 15 * 60_000 });
      // The Codex provider's URL is not in this environment: redact it too before anything prints.
      const r = {
        ...raw,
        stdout: redact(raw.stdout, SECRETS),
        stderr: redact(raw.stderr, SECRETS),
      };
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${shape}-${harness}.jsonl`), `${r.stdout}\n--- stderr\n${r.stderr}`);
      console.log(
        `${shape} ${harness}: started ${started} at load ${load.toFixed(1)} on ${cpus} CPUs, exit ${r.status}, ${Math.round(r.ms / 1000)} s`,
      );
      expect(r.status, shown(r)).toBe(0);

      const e = EXPECTED[shape];
      const block = (await m.read(`${fx}/${e.block}`)) ?? "";
      expect(block, shown(r)).toMatch(/<!-- squeal:begin v\d+ [^\n]*-->[\s\S]*<!-- squeal:end -->/);
      if (e.gate !== null) expect(block).toContain(e.gate);
      const config = JSON.parse((await m.read(`${fx}/squeal.config.json`)) ?? "{}") as {
        slow?: { include?: string[] };
        inputs?: Record<string, string[]>;
      };
      expect(config.slow?.include).toContain(e.slow);
      expect(
        Object.values(config.inputs ?? {})
          .flat()
          .some((g) => g.startsWith(e.input)),
      ).toBe(true);
      const settings = JSON.parse((await m.read(`${fx}/.claude/settings.json`)) ?? "{}") as {
        enabledPlugins?: Record<string, boolean>;
      };
      expect(settings.enabledPlugins?.["squeal@hearsay"]).toBe(true);
      const plan = JSON.parse(
        ok(await m.squeal(["setup", "--plan", "--json"], fx), "setup --plan").stdout,
      ) as { codexTrust: { state: string } };
      expect(plan.codexTrust.state).toBe("trusted");

      // Never commits or stages.
      expect((await m.sh("git rev-parse HEAD", [], { cwd: fx })).stdout.trim()).toBe(head);
      expect((await m.sh("git diff --cached --quiet", [], { cwd: fx })).status).toBe(0);
    });
  },
);
