import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  antigravityDataOf,
  antigravityInstalls,
  antigravityKeeps,
  antigravityPluginOf,
} from "./antigravity-fixture.js";
import { writeCurrent, writeFixedPlugin, writeRuntime } from "./codex-runtime-fixture.js";
import { LAUNCHER, type Machine, machine, writePlugin } from "./install-fixture.js";

/*
 * Spec 024 D1, the launcher of format 9: it finds Squeal installed in
 * Antigravity at ~/.gemini/config/plugins/squeal, and as
 * <PLUGIN_DATA>/bin/squeal in Antigravity's data directory it runs the newest
 * copy under <PLUGIN_DATA>/versions/, even when the fixed Codex plugin of
 * spec 002 D7 is installed too.
 */

const TEXT = readFileSync(LAUNCHER, "utf8");

function launch(m: Machine, launcher = LAUNCHER, args: readonly string[] = ["status"]) {
  const r = m.sh([launcher, ...args]);
  const ran =
    r.stdout === "" ? null : (JSON.parse(r.stdout) as { version: string; harness: string });
  return { ...r, ran };
}

function codexInstalls(m: Machine, version: string): void {
  writePlugin(
    join(m.codexHome, "plugins", "cache", "hearsay", "squeal", version),
    "codex",
    version,
  );
}

/** The fixed Codex plugin with its seed and a current runtime, as after install.sh (spec 002 D7 to D9). */
function fixedCodex(m: Machine, version: string): void {
  writeFixedPlugin(
    join(m.codexHome, "plugins", "cache", "hearsay", "squeal", "1.0.0"),
    "1.0.0",
    version,
    TEXT,
  );
  const data = join(m.codexHome, "plugins", "data", "squeal-hearsay");
  writeRuntime(join(data, "versions", version), version, TEXT);
  writeCurrent(data, version);
}

describe("the launcher with Antigravity", () => {
  it("carries format 9", () => {
    expect(TEXT).toMatch(/^#!\/bin\/sh\n# squeal-launcher format 9\n/);
  });

  it("runs Squeal installed in Antigravity, and names it among the harnesses", () => {
    const m = machine();
    antigravityInstalls(m, "0.1.600");
    expect(launch(m).ran).toEqual({ version: "0.1.600", harness: "antigravity", args: ["status"] });
    codexInstalls(m, "0.1.599");
    const r = launch(m);
    expect(r.ran).toMatchObject({ version: "0.1.600", harness: "antigravity" });
    expect(r.stderr).toBe(
      "squeal: this command runs squeal 0.1.600; plugins: Codex 0.1.599 and Antigravity 0.1.600. Run squeal update to bring the plugins to one version.\n",
    );
  });

  it("skips an Antigravity plugin without its CLI or a version", () => {
    const m = machine();
    antigravityInstalls(m, "0.1.600");
    rmSync(join(antigravityPluginOf(m), "dist", "cli", "squeal.mjs"));
    codexInstalls(m, "0.1.599");
    expect(launch(m).ran).toMatchObject({ version: "0.1.599", harness: "codex" });
    antigravityInstalls(m, "0.1.600");
    writeFileSync(join(antigravityPluginOf(m), "plugin.json"), "{}");
    expect(launch(m).ran).toMatchObject({ version: "0.1.599", harness: "codex" });
  });
});

describe("the launcher in Antigravity's data directory", () => {
  it("runs the copy over the installed plugin of the same version, and says nothing", () => {
    const m = machine();
    antigravityInstalls(m, "0.1.600");
    const r = launch(m, antigravityKeeps(m, "0.1.600", TEXT));
    expect(r.ran).toMatchObject({ version: "0.1.600", harness: "antigravity" });
    expect(r.stderr).toBe("");
  });

  it("runs its newest copy beside the fixed Codex plugin", () => {
    const m = machine();
    fixedCodex(m, "0.1.599");
    const launcher = antigravityKeeps(m, "0.1.600", TEXT);
    rmSync(antigravityPluginOf(m), { recursive: true, force: true });
    const r = launch(m, launcher);
    expect(r.ran).toMatchObject({ version: "0.1.600", harness: "antigravity" });
    // The Codex launcher, by contrast, keeps to its managed runtime.
    expect(launch(m).ran?.version).toBe("0.1.599");
  });

  it("names Antigravity sessions in the notice of an older copy, once per conversation, marked beside it", () => {
    const m = machine();
    antigravityInstalls(m, "0.1.601");
    const launcher = antigravityKeeps(m, "0.1.600", TEXT);
    m.env.ANTIGRAVITY_CONVERSATION_ID = "c1";
    const first = launch(m, launcher);
    expect(first.ran).toMatchObject({ version: "0.1.601" });
    expect(first.stderr).toBe(
      "squeal: this command runs squeal 0.1.601; plugins: Antigravity 0.1.601; Antigravity sessions started on 0.1.600 keep 0.1.600 until they restart.\n",
    );
    expect(launch(m, launcher).stderr).toBe("");
    expect(existsSync(join(antigravityDataOf(m), "launcher-notices.json"))).toBe(true);
    m.env.ANTIGRAVITY_CONVERSATION_ID = "c2";
    expect(launch(m, launcher).stderr).toBe(first.stderr);
  });
});
