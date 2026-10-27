import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentFile } from "../../src/harness/codex/adapter/layout.js";
import { codexDataOf } from "./codex-runtime-fixture.js";
import {
  type FixedCodex,
  install,
  launcherOf,
  type Machine,
  machine,
  ownedOf,
  snapshot,
} from "./install-fixture.js";

/*
 * Spec 002 D7 and D8, `install.sh` with the fixed Codex plugin: one plugin,
 * then this release's runtime through the seed's `squeal codex-runtime`
 * (`tasks/wave-5-contract.md`), before the install reports success.
 */

const FIXED: FixedCodex = { adapter: "1.0.0", seed: "0.1.360" };
const RELEASE = "0.1.370";

const cacheOf = (m: Machine) => join(m.codexHome, "plugins", "cache", "hearsay", "squeal");
const rootOf = (m: Machine) => join(cacheOf(m), FIXED.adapter);
const currentOf = (m: Machine) =>
  (JSON.parse(readFileSync(currentFile(codexDataOf(m.codexHome)), "utf8")) as { version: string })
    .version;
const ensure = (m: Machine) => `squeal codex-runtime ensure --plugin-root ${rootOf(m)}`;
const update = (m: Machine, v = RELEASE) =>
  `squeal codex-runtime update --plugin-root ${rootOf(m)} --tag squeal--v${v}`;

function fixedMachine(harnesses: Parameters<typeof machine>[0] = ["codex"]): Machine {
  const m = machine(harnesses);
  m.publish(RELEASE, undefined, FIXED);
  return m;
}

/** Runs the installed launcher as the user's terminal would, and reads the CLI's report. */
function squeal(m: Machine, ...args: string[]) {
  const r = m.sh([launcherOf(m), ...args]);
  return { ...r, ran: r.stdout === "" ? null : (JSON.parse(r.stdout) as Record<string, unknown>) };
}

// Each installer run spawns about ten processes; 1.9 s alone at a load of 77 on 24 cores, past 5 s under the full suite.
describe("install.sh with the fixed Codex plugin", { timeout: 30_000 }, () => {
  it("installs one plugin, then this release's runtime, and runs it from the terminal", () => {
    const m = fixedMachine();
    const r = install(m);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([
      `codex plugin marketplace add file://${m.hub}`,
      "codex plugin add squeal@hearsay",
      ensure(m),
      update(m),
    ]);
    expect(readdirSync(cacheOf(m))).toEqual([FIXED.adapter]);
    expect(r.stdout).toContain(
      `$ node --disable-warning=ExperimentalWarning ${rootOf(m)}/seed/dist/cli/squeal.mjs codex-runtime ensure --plugin-root ${rootOf(m)}\n`,
    );
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("Next, in each repository: squeal setup");
    expect(currentOf(m)).toBe(RELEASE);
    const runtime = join(codexDataOf(m.codexHome), "versions", RELEASE);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(
      readFileSync(join(runtime, "bin", "squeal-launcher"), "utf8"),
    );
    expect(squeal(m, "--version").ran).toEqual({
      version: RELEASE,
      harness: "codex-runtime",
      args: ["--version"],
      cli: join(runtime, "dist", "cli", "squeal.mjs"),
    });
  });

  it("reports a failed runtime update as a failure, keeps the seed it prepared, and a rerun provisions", () => {
    const m = fixedMachine();
    m.env.STUB_FAIL = "squeal codex-runtime update";
    const r = install(m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`installing Squeal runtime ${RELEASE} for Codex failed`);
    expect(r.stderr).toContain(`Codex sessions use the runtime prepared before it, not ${RELEASE}`);
    expect(r.stdout).not.toContain("Next, in each repository");
    expect(existsSync(launcherOf(m))).toBe(false);
    // The seed serves Codex sessions offline; it is not called current.
    expect(currentOf(m)).toBe(FIXED.seed);
    expect(readFileSync(ownedOf(m), "utf8")).toBe("codex\n");
    delete m.env.STUB_FAIL;
    m.clearLog();
    const again = install(m);
    expect(again.stderr).toBe("");
    expect(again.status).toBe(0);
    expect(m.calls()).toEqual([ensure(m), update(m)]);
    expect(currentOf(m)).toBe(RELEASE);
  });

  it("stops when the seed runtime cannot be prepared, before any update", () => {
    const m = fixedMachine();
    m.env.STUB_FAIL = "squeal codex-runtime ensure";
    const r = install(m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      `Codex has squeal@hearsay ${FIXED.adapter}, but preparing its seed runtime failed`,
    );
    expect(m.calls()).not.toContain(update(m));
    expect(existsSync(launcherOf(m))).toBe(false);
  });

  it("checks the runtime on a second run and changes nothing", () => {
    const m = fixedMachine();
    expect(install(m).status).toBe(0);
    const before = snapshot(m.home);
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([ensure(m), update(m)]);
    expect(snapshot(m.home)).toEqual(before);
    expect(r.stdout).toContain(
      `Codex has squeal@hearsay ${FIXED.adapter}; squeal update updates it`,
    );
  });

  it("provisions under a Codex home whose path has spaces", () => {
    const m = fixedMachine();
    m.env.CODEX_HOME = join(m.root, "my codex home");
    const r = install(m);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(currentOf({ ...m, codexHome: m.env.CODEX_HOME })).toBe(RELEASE);
    expect(squeal(m).ran).toMatchObject({ version: RELEASE, harness: "codex-runtime" });
  });

  it("compares Claude Code's plugin with the Codex runtime, never with the adapter version", () => {
    const m = fixedMachine(["claude", "codex"]);
    const r = install(m);
    expect(r.status).toBe(0);
    const ran = squeal(m, "status");
    expect(ran.ran).toMatchObject({ version: RELEASE });
    expect(ran.stderr).toBe("");
  });

  it("provisions a fixed plugin that replaced a legacy one, which carried its own runtime", () => {
    const m = machine(["codex"]);
    m.publish("0.1.367");
    expect(install(m).status).toBe(0);
    expect(m.calls().some((c) => c.startsWith("squeal "))).toBe(false);
    m.publish(RELEASE, undefined, FIXED);
    expect(m.sh(["-c", "codex plugin marketplace upgrade hearsay"]).status).toBe(0);
    m.clearLog();
    const r = install(m);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([ensure(m), update(m)]);
    expect(squeal(m).ran).toMatchObject({ version: RELEASE, harness: "codex-runtime" });
  });

  it("removes the plugin it installed on uninstall, and names the runtimes Codex sessions may still use", () => {
    const m = fixedMachine();
    expect(install(m).status).toBe(0);
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual(["codex plugin remove squeal@hearsay"]);
    expect(existsSync(launcherOf(m))).toBe(false);
    const data = codexDataOf(m.codexHome);
    expect(existsSync(join(data, "versions", RELEASE))).toBe(true);
    expect(r.stdout).toContain(`Squeal's Codex runtimes stay in ${data}`);
  });
});
