import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { readMarks } from "../../src/core/capacity/index.js";
import { slowSlotDir } from "../../src/core/slow/index.js";
import { childEnv } from "../daemon/helpers.js";
import { until } from "../e2e/support.js";
import { runMissingConfig } from "../helpers/baseline.js";

/*
 * Review 001-384, B3, through a daemon run from the sources: a
 * `--separate-git-dir` repository whose user config caps its root at 2 slots
 * runs its baseline's backlog on a grant of 2 of the host's 8, and its pool
 * mark names the root as its project. Before the repair the daemon looked
 * the metadata directory up, found no entry and took 4. The four node:test
 * files hold until the test releases them, so the mark is read while they
 * run: in one-file slots, one permit each (task 011-21 slice 2), the mark of
 * a lane that wants a third slot holds 2. Every path is temporary: HOME, XDG_CONFIG_HOME and
 * XDG_RUNTIME_DIR (`childEnv`), git's config shut out.
 */

const REPO = resolve(import.meta.dirname, "../..");
const CLI = join(REPO, "src/cli/index.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-capacity-project-")));
const runtime = realpathSync(mkdtempSync("/tmp/sq-"));
const release = join(scratch, "release");
const SLOW = { timeout: 300_000 } as const;

const daemons: ChildProcess[] = [];
afterAll(async () => {
  writeFileSync(release, "");
  for (const daemon of daemons) daemon.kill("SIGTERM");
  await Promise.all(
    daemons.map((d) => (d.exitCode === null ? new Promise((done) => d.once("exit", done)) : null)),
  );
  rmSync(scratch, { recursive: true, force: true });
  rmSync(runtime, { recursive: true, force: true });
});

const held = `import { test } from "node:test";
import { existsSync } from "node:fs";
test("held", async () => {
  while (!existsSync(${JSON.stringify(release)})) await new Promise((r) => setTimeout(r, 50));
});
`;

function createRepo(): string {
  const root = join(scratch, "root");
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "app", private: true, type: "module" })}\n`,
    "squeal.config.json": runMissingConfig(
      JSON.stringify({
        nodeTest: [
          { name: "p", node: process.execPath, argv: [], env: {}, include: ["test/*.test.mjs"] },
        ],
      }),
    ),
  };
  for (const n of [1, 2, 3, 4]) files[`test/h${n}.test.mjs`] = held;
  mkdirSync(join(root, "test"), { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  const env = {
    PATH: process.env.PATH,
    HOME: join(scratch, "home"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  const git = (args: readonly string[]) =>
    execFileSync("git", args, { cwd: root, env, stdio: "pipe" });
  git(["init", "-q", "-b", "main", "--separate-git-dir", join(scratch, "meta"), root]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  return realpathSync(root);
}

describe("a --separate-git-dir repository's capacity.projects cap (review 001-384, B3)", () => {
  it("applies to its daemon's backlog and names its root in the pool mark", SLOW, async () => {
    const root = createRepo();
    const env = childEnv(runtime);
    const config = join(env.XDG_CONFIG_HOME as string, "squeal", "config.json");
    mkdirSync(join(config, ".."), { recursive: true });
    writeFileSync(
      config,
      JSON.stringify({ capacity: { hostSlots: 8, projects: { [root]: { slots: 2 } } } }),
    );
    const child = spawn(process.execPath, ["--import", TSX, CLI, "daemon", root], {
      cwd: root,
      env,
      stdio: "ignore",
    });
    daemons.push(child);
    const dir = slowSlotDir(env);
    const mark = await until("the pool mark of a third slot", 120_000, async () => {
      const [found] = readMarks(dir, "reader", Date.now());
      return found !== undefined && found.want >= 3 ? found : null;
    });
    expect({ want: mark.want, grant: mark.grant, project: mark.project }).toEqual({
      want: 3,
      grant: 2,
      project: { id: root, slots: 2 },
    });
  });
});
