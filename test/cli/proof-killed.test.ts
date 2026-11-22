import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run } from "./status-at-kit.js";
import { alive, gone, stateOf, waitFor } from "./status-at-processes.js";

/*
 * Rows 023-08 and 023-11, done-when; spec 023 D6: a `squeal proof` killed
 * with SIGKILL while its red side runs a test leaves no process running, a
 * process the test started included, and its checkouts are gone after the
 * next command's sweep: the red side's, and the green side's at HEAD, open
 * around it (row 023-42: the commit worktree at HEAD, whose daemon the
 * child ran in its own process, so it died with it). Row 023-11: under a condition too, with the run's own `HOME`
 * inside the red checkout, whose links the sweep removes without their
 * targets. The test writes its worker's pid and its started process's pid
 * where `HOLD_OUT` says, then holds.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CHILD = resolve(import.meta.dirname, "proof-cli-child.ts");

// Row 023-42: it holds on the red side only (A's code); the green side at HEAD, asked of the
// commit daemon first, passes at once.
const HOLD_TEST = [
  'import { spawn } from "node:child_process";',
  'import { writeFileSync } from "node:fs";',
  'import { it } from "vitest";',
  'import { value } from "../src/a";',
  'it("holds", async () => {',
  "  if (value === 2) return;",
  '  const held = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
  "  const pids = { worker: process.pid, held: held.pid };",
  "  writeFileSync(process.env.HOLD_OUT ?? '', JSON.stringify(pids));",
  "  await new Promise((done) => setTimeout(done, 600_000 + value));",
  "}, 700_000);",
  "",
].join("\n");

/** A proof of `HOLD_TEST` killed while its red side holds; `more` of its arguments, `env` its own. */
async function killed(more: object, env: NodeJS.ProcessEnv, home?: string) {
  const f = fixture({ "squeal.config.json": "{}\n", "src/a.ts": "export const value = 1;\n" });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", "test/a.test.ts": HOLD_TEST });
  const held = join(f.dir, "held");
  const args = [f.root, "test/a.test.ts", a, f.cacheRoot, JSON.stringify(more)];
  const child = spawn(process.execPath, ["--import", TSX, CHILD, ...args], {
    stdio: "ignore",
    env: { ...process.env, ...env, HOLD_OUT: held },
  });
  const exited = new Promise((done) => child.once("exit", done));
  let pids: number[] = [];
  try {
    try {
      await waitFor(held, 120_000);
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
    const marks = JSON.parse(readFileSync(held, "utf8")) as { worker: number; held: number };
    pids = [marks.worker, marks.held];
    expect(marks.worker).not.toBe(child.pid);
    for (const pid of pids) expect(await gone(pid, 15_000), stateOf(pid)).toBe(true);
    // The green side's checkout at HEAD (row 023-42: its commit worktree, whose daemon ran in the
    // killed process) stays while the red side runs in its own.
    const open = f.checkouts();
    expect(open).toHaveLength(2);
    // Row 023-11: the run's own HOME lies in the red side's checkout folder.
    if (home !== undefined) expect(open.some((dir) => existsSync(join(dir, "home")))).toBe(true);

    // The next command that makes a checkout sweeps the dead one first.
    await run(f, { commit: a, json: true });
    clean(f);
  } finally {
    for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
}

describe("a killed squeal proof (rows 023-08, 023-11, D6)", SLOW, () => {
  it("leaves no process running, and its checkout is swept by the next command", async () => {
    await killed({}, {});
  });

  it("under a condition, also with its own HOME: the sweep removes it and leaves the real HOME", async () => {
    const home = mkdtempSync(join(tmpdir(), "sq-proof-home-"));
    try {
      writeFileSync(join(home, ".proofrc"), "ada\n");
      writeFileSync(join(home, ".kept"), "kept\n");
      const more = { without: [join(home, ".proofrc")], env: [{ name: "PROOF_X", value: "1" }] };
      await killed(more, { HOME: home }, home);
      expect(readFileSync(join(home, ".proofrc"), "utf8")).toBe("ada\n");
      expect(readFileSync(join(home, ".kept"), "utf8")).toBe("kept\n");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
