import { execFile, execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  ATOMIC,
  applyReference,
  retryEnv,
  type Scenario,
  SERVICE_FILES,
  scenarioOf,
} from "../../evals/lib/index.mjs";
import { alive } from "./fake-cell.js";

// 006-53: the retry scenarios' knobs (evals/lib/retry-knobs.mjs): the load preload in a real
// node, the rates service, and the fixture's rates test against it.

const EVALS = join(import.meta.dirname, "../../evals");
const VITEST = createRequire(import.meta.url).resolve("vitest/package.json");
const MODULES = dirname(dirname(VITEST));

const dirs: string[] = [];
const ports: string[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) rmSync(p, { force: true }); // stops a service still up
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "squeal-retry-knobs-"));
  dirs.push(d);
  return d;
};
/** What a node process with `env` reads as the load per CPU, through a named import as Squeal's. */
const perCpu = (env: Record<string, string | undefined>) =>
  Number(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import { availableParallelism, loadavg } from "node:os"; console.log(loadavg()[0] / availableParallelism());',
      ],
      { env, encoding: "utf8" },
    ),
  );

describe("the pinLoad knob", () => {
  it("pins the load every node process of the cell reads, changeable under it", () => {
    const cell = scratch();
    const env: Record<string, string | undefined> = { PATH: process.env.PATH };
    const setLoad = retryEnv({ pinLoad: 0.2 }, cell, env);
    expect(env.NODE_OPTIONS).toBe(`--import=file://${join(cell, "tmp/load/loadavg.mjs")}`);
    expect(perCpu(env)).toBeCloseTo(0.2, 6);
    setLoad?.(2.4);
    expect(perCpu(env)).toBeCloseTo(2.4, 6);
    // Added to an inherited NODE_OPTIONS.
    const more: Record<string, string | undefined> = { NODE_OPTIONS: "--no-warnings" };
    retryEnv({ pinLoad: 0.2 }, scratch(), more);
    expect(more.NODE_OPTIONS).toMatch(/^--no-warnings --import=file:\/\/.*loadavg\.mjs$/);
  });

  it("sets nothing for a scenario without the retry knobs", () => {
    const cell = scratch();
    const env = { PATH: "/bin" };
    expect(retryEnv({ staleEdit: { path: "x", append: "y" } }, cell, env)).toBeNull();
    expect(env).toEqual({ PATH: "/bin" });
    expect(existsSync(join(cell, "tmp/load"))).toBe(false);
  });
});

/** A fixture copy with the service's files and its port file under the copy's directory. */
function serviceFixture() {
  const dir = scratch();
  const work = join(dir, "work");
  cpSync(join(EVALS, "ledgerline"), work, { recursive: true });
  for (const f of SERVICE_FILES) cpSync(join(ATOMIC, "retry", f), join(work, f));
  symlinkSync(MODULES, join(work, "node_modules"));
  const port = join(dir, "rates.port");
  ports.push(port);
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: dir,
    TMPDIR: dir,
    LEDGERLINE_RATES_PORT_FILE: port,
  };
  const service = () =>
    spawnSync(process.execPath, ["scripts/rates-service.mjs"], {
      cwd: work,
      env,
      encoding: "utf8",
      timeout: 20_000,
    }).stdout;
  const ratesTest = (cwd: string) =>
    promisify(execFile)(
      process.execPath,
      [join(dirname(VITEST), "vitest.mjs"), "run", "test/rates.test.ts"],
      { cwd, env },
    ).then(
      (r) => ({ ok: true, out: r.stdout + r.stderr }),
      (e: { stdout: string; stderr: string }) => ({ ok: false, out: e.stdout + e.stderr }),
    );
  return { dir, work, port, service, ratesTest };
}
/** The service serving port file `port`: its command line names the file, under the cell. */
const servicePid = (port: string) =>
  Number(
    spawnSync("pgrep", ["-f", `rates-service.mjs --serve ${port}`], { encoding: "utf8" }).stdout,
  );
const until = async (ok: () => boolean, ms = 5000) => {
  for (const t0 = Date.now(); !ok() && Date.now() - t0 < ms; )
    await new Promise((r) => setTimeout(r, 50));
  return ok();
};

describe("the service knob's rates service", { timeout: 60_000 }, () => {
  it("starts in the background on a port of its own, serves only v1, and stops with its port file", async () => {
    const f = serviceFixture();
    expect(f.service()).toMatch(/^rates service listening on 127\.0\.0\.1:\d+\n$/);
    const port = readFileSync(f.port, "utf8").trim();
    expect(f.service()).toBe(`rates service already running on 127.0.0.1:${port}\n`);
    const v1 = await fetch(`http://127.0.0.1:${port}/v1/rates/EUR/USD`);
    expect([v1.status, await v1.json()]).toEqual([200, { rate: 1.08 }]);
    expect((await fetch(`http://127.0.0.1:${port}/v2/rates/EUR/USD`)).status).toBe(503);
    const pid = servicePid(f.port);
    expect(pid).toBeGreaterThan(0);
    rmSync(f.port);
    expect(await until(() => !alive(pid))).toBe(true);
  });

  it("is what the rates test needs: down fails it, up passes it, a10's edit fails it", async () => {
    const f = serviceFixture();
    const down = await f.ratesTest(f.work);
    expect(down.ok).toBe(false);
    expect(down.out).toContain(
      `the rates service is not running (no ${f.port}); start it with: node scripts/rates-service.mjs`,
    );
    f.service();
    expect((await f.ratesTest(f.work)).ok).toBe(true);
    // a9's reference keeps it passing; a10's asks for v2, which the service answers 503.
    const a10 = join(f.dir, "a10");
    cpSync(f.work, a10, { recursive: true, verbatimSymlinks: true });
    applyReference(f.work, scenarioOf("a9-env-retry") as Scenario);
    applyReference(a10, scenarioOf("a10-retry-real") as Scenario);
    const [a9run, a10run] = await Promise.all([f.ratesTest(f.work), f.ratesTest(a10)]);
    expect(a9run.ok, a9run.out).toBe(true);
    expect(a10run.ok).toBe(false);
    expect(a10run.out).toContain("the rates service answered 503 Service Unavailable");
  });
});
