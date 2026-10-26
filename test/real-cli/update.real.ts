import { afterEach, describe, expect, it } from "vitest";
import { BASE_VERSION, laterVersion, type Machine, machine, ok } from "./machine.js";
import { claudeVersions, codexVersions, shown } from "./state.js";

/*
 * Spec 005 Testing, end to end, bullet 2: the launcher across a plugin update
 * in each harness, the other left behind, and `squeal update` bringing the two
 * versions to one. The later version's bundles carry its number, so
 * `squeal --version` names the plugin the launcher ran.
 */

let current: Machine | null = null;
afterEach(async () => {
  await current?.dispose();
  current = null;
});

const LATER = laterVersion();

const UPDATES = [
  {
    harness: "Claude Code",
    commands: [
      ["claude", "plugin", "marketplace", "update", "hearsay"],
      ["claude", "plugin", "update", "squeal@hearsay"],
    ],
    claude: LATER,
    codex: BASE_VERSION,
  },
  {
    harness: "Codex",
    commands: [["codex", "plugin", "marketplace", "upgrade", "hearsay"]],
    claude: BASE_VERSION,
    codex: LATER,
  },
] as const;

describe.each(UPDATES)("an update in $harness alone", (u) => {
  it("runs the newer plugin with one skew line, until squeal update brings both to it", async () => {
    const m = await machine(["claude", "codex"]);
    current = m;
    ok(await m.install(), "install.sh");
    await m.publish(LATER);
    for (const [cmd, ...args] of u.commands)
      ok(await m.run(cmd, args, { timeoutMs: 300_000 }), `${cmd} ${args.join(" ")}`);
    expect(await claudeVersions(m)).toEqual([u.claude]);
    expect(await codexVersions(m)).toEqual([u.codex]);

    const skewed = await m.squeal(["--version"], m.home);
    expect(skewed.status, shown(skewed)).toBe(0);
    expect(skewed.stdout.trim()).toBe(LATER);
    expect(skewed.stderr).toBe(
      `squeal: this command runs squeal ${LATER}; plugins: Claude Code ${u.claude} and Codex ${u.codex}. Run squeal update to bring the plugins to one version.\n`,
    );

    const update = await m.squeal(["update"], m.home);
    expect(update.status, shown(update)).toBe(0);
    expect(update.stdout).toContain(`Claude Code: squeal@hearsay ${LATER}`);
    expect(update.stdout).toContain(`Codex: squeal@hearsay ${LATER}`);
    expect(await claudeVersions(m)).toEqual([LATER]);
    expect(await codexVersions(m)).toEqual([LATER]);

    const one = await m.squeal(["--version"], m.home);
    expect(one.status, shown(one)).toBe(0);
    expect(one.stdout.trim()).toBe(LATER);
    expect(one.stderr).toBe("");
  });
});
