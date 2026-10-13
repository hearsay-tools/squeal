import { afterEach, describe, expect, it } from "vitest";
import { BASE_VERSION, type HarnessCli, type Machine, machine } from "./machine.js";
import { claudeVersions, codexVersions, exists, ownedRecord, shown, snapshot } from "./state.js";

/*
 * Spec 005 Testing, end to end, bullet 1: `install.sh` in a scratch HOME and
 * CODEX_HOME with both harnesses and with each alone: plugins installed, the
 * launcher on the PATH, a second run changing nothing, `--uninstall` leaving
 * nothing it created.
 */

let current: Machine | null = null;
afterEach(async () => {
  await current?.dispose();
  current = null;
});

async function fresh(harnesses: readonly HarnessCli[]): Promise<Machine> {
  current = await machine(harnesses);
  return current;
}

const SHAPES: readonly (readonly [string, readonly HarnessCli[]])[] = [
  ["both harnesses", ["claude", "codex"]],
  ["Claude Code alone", ["claude"]],
  ["Codex alone", ["codex"]],
];

describe.each(SHAPES)("install.sh with %s", (_, harnesses) => {
  it("installs, changes nothing the second time, and uninstalls what it created", async () => {
    const m = await fresh(harnesses);
    const first = await m.install();
    expect(first.status, shown(first)).toBe(0);
    expect(first.stdout).toContain("Next, in each repository: squeal setup");
    expect(await claudeVersions(m)).toEqual(harnesses.includes("claude") ? [BASE_VERSION] : []);
    expect(await codexVersions(m)).toEqual(harnesses.includes("codex") ? [BASE_VERSION] : []);

    // The launcher by name, from the PATH, running the installed plugin.
    const version = await m.run("squeal", ["--version"]);
    expect(version.status, shown(version)).toBe(0);
    expect(version.stdout.trim()).toBe(BASE_VERSION);
    expect(version.stderr).toBe("");

    const dirs = [m.home, m.codexHome];
    const before = await snapshot(m, dirs);
    const second = await m.install();
    expect(second.status, shown(second)).toBe(0);
    expect(second.stdout).not.toMatch(/^\$ (claude|codex|cp) /m);
    expect(await snapshot(m, dirs)).toEqual(before);

    const gone = await m.install("--uninstall");
    expect(gone.status, shown(gone)).toBe(0);
    expect(await exists(m, m.launcher)).toBe(false);
    expect(await exists(m, ownedRecord(m))).toBe(false);
    expect(await claudeVersions(m)).toEqual([]);
    expect(await codexVersions(m)).toEqual([]);
    const after = await m.run("squeal", ["--version"]);
    expect(after.status).not.toBe(0);
    // D3: the marketplace stays added, and the script says how to remove it.
    expect(gone.stdout).toContain("The hearsay marketplace stays added");
  });
});

describe("install.sh beside an install it did not make", () => {
  it("leaves a plugin that was there before and names the command that removes it", async () => {
    const m = await fresh(["claude"]);
    const add = await m.run("claude", ["plugin", "marketplace", "add", m.hub]);
    expect(add.status, shown(add)).toBe(0);
    const own = await m.run("claude", ["plugin", "install", "squeal@hearsay"]);
    expect(own.status, shown(own)).toBe(0);
    const ran = await m.install();
    expect(ran.status, shown(ran)).toBe(0);
    expect(ran.stdout).toContain(`Claude Code has squeal@hearsay ${BASE_VERSION}`);
    const gone = await m.install("--uninstall");
    expect(gone.status, shown(gone)).toBe(0);
    expect(await claudeVersions(m)).toEqual([BASE_VERSION]);
    expect(gone.stdout).toContain("claude plugin uninstall squeal@hearsay removes it");
    expect(await exists(m, m.launcher)).toBe(false);
  });
});
