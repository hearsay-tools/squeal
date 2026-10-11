import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { groundTruth, runBounded } from "../../evals/lib/index.mjs";

// Review 006-03 S2 and B3 (the runner's half), with fake binaries: a command that cannot start,
// a process tree that ignores SIGTERM, and the ground truth's completion records.
const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "squeal-evals-teardown-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const script = (dir: string, name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
};
const quiet = () => {};

describe("runBounded (S2)", () => {
  it("records a command that cannot start as a spawn error, not an exit", async () => {
    const d = scratch();
    const r = await runBounded({
      command: join(d, "no-such-harness"),
      args: [],
      cwd: d,
      env: process.env,
      timeoutMs: 5000,
      log: quiet,
    });
    expect(r).toEqual({ exit: null, signal: null, timedOut: false, spawnError: "ENOENT" });
  });

  it("escalates TERM then KILL to the whole process group by its deadline", async () => {
    const d = scratch();
    const pids = join(d, "pids");
    const harness = script(
      d,
      "stuck",
      `trap '' TERM\n(trap '' TERM; echo $$ > "${pids}.child"; while :; do sleep 1; done) &\necho $$ > "${pids}"\nwhile :; do sleep 1; done`,
    );
    const t0 = Date.now();
    const logged: string[] = [];
    const r = await runBounded({
      command: harness,
      args: [],
      cwd: d,
      env: process.env,
      timeoutMs: 600,
      graceMs: 400,
      log: (s: string) => logged.push(s),
    });
    expect(r).toEqual({ exit: null, signal: "SIGKILL", timedOut: true, spawnError: null });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(logged.join("\n")).toMatch(/SIGTERM[\s\S]*SIGKILL/);
    // The grandchild that also ignored TERM is gone with its group.
    const child = Number(readFileSync(`${pids}.child`, "utf8"));
    await new Promise((r) => setTimeout(r, 100));
    expect(alive(child)).toBe(false);
  });

  it("returns a process's own exit and signal", async () => {
    const d = scratch();
    expect(
      await runBounded({
        command: script(d, "fails", "exit 3"),
        args: [],
        cwd: d,
        env: process.env,
        timeoutMs: 5000,
        log: quiet,
      }),
    ).toEqual({ exit: 3, signal: null, timedOut: false, spawnError: null });
    expect(
      await runBounded({
        command: script(d, "killed", "kill -TERM $$"),
        args: [],
        cwd: d,
        env: process.env,
        timeoutMs: 5000,
        log: quiet,
      }),
    ).toEqual({ exit: null, signal: "SIGTERM", timedOut: false, spawnError: null });
  });
});

describe("groundTruth writes out/truth.json (B3)", () => {
  // A work tree whose `npx` is a fake: it writes `report` to the --outputFile, then does `then`.
  const cell = (npx: string, nodeTests: string[] = ["changelog.test.mjs"]) => {
    const d = scratch();
    const bin = join(d, "bin");
    mkdirSync(bin);
    mkdirSync(join(d, "work/scripts"), { recursive: true });
    for (const f of nodeTests)
      writeFileSync(
        join(d, "work/scripts", f),
        "import test from 'node:test'; test('x', () => {});\n",
      );
    script(bin, "npx", npx);
    mkdirSync(join(d, "out"));
    const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` };
    return { work: join(d, "work"), out: join(d, "out"), env };
  };
  const truthOf = (out: string) => JSON.parse(readFileSync(join(out, "truth.json"), "utf8"));
  const report = `for a in "$@"; do case $a in --outputFile=*) echo '{"numFailedTests":0,"testResults":[]}' > "\${a#--outputFile=}";; esac; done`;

  it("records both commands' completion", async () => {
    const c = cell(`${report}\nexit 1`);
    const t = await groundTruth({ cwd: c.work, env: c.env, out: c.out, log: quiet });
    const want = { exit: 1, signal: null, timedOut: false, spawnError: null };
    expect(t).toEqual(truthOf(c.out));
    expect(t.vitest).toEqual(want);
    expect(t.nodeTest).toEqual({ ...want, exit: 0, files: 1 });
    expect(JSON.parse(readFileSync(join(c.out, "truth.vitest.json"), "utf8")).testResults).toEqual(
      [],
    );
    expect(readFileSync(join(c.out, "truth.node.txt"), "utf8")).toMatch(/pass 1/);
  });

  it("records a timeout, a signal and a missing node:test file, never an exit 0", async () => {
    const hung = cell("trap '' TERM\nwhile :; do sleep 1; done", []);
    const t = await groundTruth({
      cwd: hung.work,
      env: hung.env,
      out: hung.out,
      log: quiet,
      timeoutMs: 400,
      graceMs: 200,
    });
    expect(t.vitest).toEqual({ exit: null, signal: "SIGKILL", timedOut: true, spawnError: null });
    expect(t.nodeTest).toEqual({
      exit: null,
      signal: null,
      timedOut: false,
      spawnError: null,
      files: 0,
    });
    const killed = cell("kill -TERM $$");
    expect(
      (await groundTruth({ cwd: killed.work, env: killed.env, out: killed.out, log: quiet }))
        .vitest,
    ).toEqual({ exit: null, signal: "SIGTERM", timedOut: false, spawnError: null });
  });

  it("records an npx that cannot start", async () => {
    const c = cell("exit 0");
    const t = await groundTruth({
      cwd: c.work,
      env: c.env,
      out: c.out,
      log: quiet,
      npx: join(c.work, "no-npx"),
    });
    expect(t.vitest.spawnError).toBe("ENOENT");
    expect(t.vitest.exit).toBeNull();
  });
});
