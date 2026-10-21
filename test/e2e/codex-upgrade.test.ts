import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, loadavg, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { codexConfig } from "../../evals/lib/index.mjs";
import { A, B, codexPluginAt } from "../harness/codex/cache-fixture.js";

/*
 * Row 005-73, test 7 of `research/plugin-cache-cleanup.md`'s Recommendation:
 * a real Codex session that spans `codex plugin marketplace upgrade` runs the
 * CLI its SQUEAL messages advertise and reads the skill they advertise,
 * without searching the cache. The marketplace is a git repository served on
 * localhost over dumb HTTP, as the 005-72 probe served it, so Codex's own
 * install deletes A's cache directory. It runs only as the throwaway user
 * `squeal-e2e`, with `codex` on its PATH, its own `~/.codex/config.toml` for
 * the provider and `SQUEAL_E2E_CODEX_MODEL` naming the model, at a one-minute
 * load below 24 on this host; otherwise it is skipped with the reason.
 */

const MAX_LOAD = 24;
const TURN_MS = 600_000;

function skipped(): string | null {
  if (userInfo().username !== "squeal-e2e") return "it runs only as the throwaway user squeal-e2e";
  const load = loadavg()[0] ?? 0;
  if (load >= MAX_LOAD) return `the one-minute load ${load.toFixed(2)} is not below ${MAX_LOAD}`;
  if (spawnSync("codex", ["--version"]).status !== 0) return "codex is not on the PATH";
  if (!existsSync(join(homedir(), ".codex", "config.toml"))) return "no ~/.codex/config.toml";
  if (!process.env.SQUEAL_E2E_CODEX_MODEL) return "SQUEAL_E2E_CODEX_MODEL is not set";
  return null;
}
const SKIP = skipped();

const T = SKIP === null ? mkdtempSync(join(homedir(), "e2e-005-73-")) : "";
let server: ChildProcess | null = null;
afterAll(() => {
  server?.kill();
  if (T !== "") rmSync(T, { recursive: true, force: true });
});

const run = (cmd: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) =>
  execFileSync(cmd, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** The `hearsay` marketplace with the plugin at `version`, committed and published. */
async function publish(mkt: string, version: string): Promise<void> {
  rmSync(join(mkt, "plugins"), { recursive: true, force: true });
  await codexPluginAt(join(mkt, "plugins", "codex"), version);
  const git = (args: string[]) => run("git", args, mkt, process.env);
  git(["add", "-A"]);
  git(["-c", "user.name=e2e", "-c", "user.email=e2e@e2e", "commit", "-qm", version]);
  git(["push", "-q", join(T, "mkt.git"), "main"]);
  run("git", ["--git-dir", join(T, "mkt.git"), "update-server-info"], T, process.env);
}

interface Item {
  readonly command: string;
  readonly exit: number | null;
  readonly output: string;
}

/** One `codex exec` turn's thread id and completed commands, from its `--json` events. */
function turn(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) {
  const out = spawnSync("codex", ["exec", "--json", ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: TURN_MS,
  });
  const events = out.stdout
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map(
      (l) => JSON.parse(l) as { type: string; thread_id?: string; item?: Record<string, unknown> },
    );
  const items: Item[] = events
    .filter((e) => e.type === "item.completed" && e.item?.type === "command_execution")
    .map((e) => ({
      command: String(e.item?.command),
      exit: typeof e.item?.exit_code === "number" ? e.item.exit_code : null,
      output: String(e.item?.aggregated_output ?? ""),
    }));
  const thread = events.find((e) => e.type === "thread.started")?.thread_id ?? null;
  return { thread, items, status: out.status, stderr: out.stderr };
}

describe("a Codex session across codex plugin marketplace upgrade (005-73, test 7)", () => {
  it.skipIf(SKIP !== null)(
    `runs its advertised CLI and reads its advertised skill without searching the cache${SKIP === null ? "" : `; skipped: ${SKIP}`}`,
    { timeout: 3 * TURN_MS },
    async () => {
      const codexHome = join(T, "codex");
      const model = process.env.SQUEAL_E2E_CODEX_MODEL ?? "";
      const config = readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
      write(join(codexHome, "config.toml"), codexConfig(config, model));
      const env = { ...process.env, CODEX_HOME: codexHome };
      const cache = join(codexHome, "plugins", "cache", "hearsay", "squeal");
      const data = join(codexHome, "plugins", "data", "squeal-hearsay");

      const mkt = join(T, "mkt");
      write(
        join(mkt, ".agents", "plugins", "marketplace.json"),
        `${JSON.stringify({ name: "hearsay", plugins: [{ name: "squeal", source: "./plugins/codex", description: "Squeal" }] })}\n`,
      );
      run("git", ["init", "-q", "-b", "main"], mkt, process.env);
      run("git", ["init", "-q", "--bare", "-b", "main", join(T, "mkt.git")], T, process.env);
      await publish(mkt, A);
      const port = Number(
        run(
          "python3",
          [
            "-c",
            "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1])",
          ],
          T,
          env,
        ).trim(),
      );
      server = spawn(
        "python3",
        ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", T],
        {
          stdio: "ignore",
        },
      );
      await new Promise((up) => setTimeout(up, 1_000));
      run("codex", ["plugin", "marketplace", "add", `http://127.0.0.1:${port}/mkt.git`], T, env);
      run("codex", ["plugin", "add", "squeal@hearsay"], T, env);

      // A repository with a node:test suite; the shipped CLI trusts the plugin's hooks.
      const repo = join(T, "repo");
      write(
        join(repo, "package.json"),
        `${JSON.stringify({ name: "e2e", private: true, type: "module" })}\n`,
      );
      write(
        join(repo, "squeal.config.json"),
        `${JSON.stringify({ nodeTest: [{ name: "unit", node: process.execPath, argv: [], include: ["test/*.test.mjs"] }] })}\n`,
      );
      write(join(repo, "src", "value.mjs"), "export const value = 1;\n");
      write(
        join(repo, "test", "a.test.mjs"),
        `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { value } from "../src/value.mjs";\ntest("value", () => assert.equal(value, 1));\n`,
      );
      run("git", ["init", "-q", "-b", "main"], repo, env);
      run("git", ["add", "-A"], repo, env);
      run(
        "git",
        ["-c", "user.name=e2e", "-c", "user.email=e2e@e2e", "commit", "-qm", "fixture"],
        repo,
        env,
      );
      run(
        "node",
        [
          join(cache, A, "dist", "cli", "squeal.mjs"),
          "init",
          "--harness",
          "codex",
          "--trust",
          "--yes",
        ],
        repo,
        env,
      );
      run("git", ["checkout", "-q", "--", "."], repo, env);

      const first = turn(
        ["-s", "danger-full-access", "-m", model, "Reply with the word ready and nothing else."],
        repo,
        env,
      );
      expect(first.thread, first.stderr).not.toBeNull();
      expect(existsSync(join(data, "versions", A, "skills", "squeal", "SKILL.md"))).toBe(true);
      expect(existsSync(join(data, "bin", "squeal"))).toBe(true);

      await publish(mkt, B);
      run("codex", ["plugin", "marketplace", "upgrade", "hearsay"], T, env);
      expect(readdirSync(cache)).toEqual([B]);

      const second = turn(
        [
          "resume",
          "-m",
          model,
          "-c",
          'sandbox_mode="danger-full-access"',
          first.thread ?? "",
          "Run the Squeal CLI command your SQUEAL messages name, with --version. Then print the first three lines of the Squeal skill file they name. Use only the paths those messages give; do not search for files. Reply with both outputs.",
        ],
        repo,
        env,
      );
      const cli = second.items.find((i) => i.command.includes(join(data, "bin", "squeal")));
      expect(cli, JSON.stringify(second.items)).toMatchObject({ exit: 0 });
      expect(cli?.output).toContain(B);
      const skill = second.items.find((i) => i.command.includes(join(data, "versions")));
      expect(skill, JSON.stringify(second.items)).toMatchObject({ exit: 0 });
      expect(skill?.output).toContain("name: squeal");
      expect(
        second.items.filter((i) => /\b(find|locate|fd)\b|plugins\/cache/.test(i.command)),
      ).toEqual([]);
    },
  );
});
