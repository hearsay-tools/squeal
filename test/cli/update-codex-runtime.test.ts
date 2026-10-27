import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { type UpdateDeps, updateCommand } from "../../src/cli/update.js";
import { readCurrent } from "../../src/harness/codex/adapter/layout.js";
import { publishRuntime, selectRuntime } from "../../src/harness/codex/adapter/store.js";
import { fixedPlugin, write, writeManifest } from "../harness/codex/adapter/fixture.js";
import { runtimeTree } from "../harness/codex/runtime-release/fixture.js";
import { answer, NEXT, release, SEED, server } from "../harness/codex/runtime-update/fixture.js";
import { tempDir } from "../store/helpers.js";

/*
 * Row 002-34 (spec 002 D8, `wave-5-contract.md`): `squeal update` with the
 * fixed Codex plugin. Codex's marketplace updates the adapter; Squeal updates
 * the runtime and reports its version apart from the adapter's. The launcher
 * comes from the selected runtime, or the seed before any selection, never
 * from the adapter's own files or over a broken selection.
 */

const launcher = (format: number) =>
  `#!/bin/sh\n# squeal-launcher format ${format}\nexec node "$0" "$@"\n`;

/** A home with the fixed plugin in Codex's cache, and `codex` on a PATH of stubs. */
function machine(options: { codex?: boolean } = {}) {
  const home = tempDir("squeal-update-codex-");
  const codexHome = join(home, ".codex");
  const plugin = fixedPlugin(
    join(codexHome, "plugins", "cache", "hearsay", "squeal", "1.0.0"),
    SEED,
  );
  write(join(plugin, "hooks", "hooks.json"), "{}\n");
  const stubs = join(home, "stubs");
  const log = join(home, "stub.log");
  writeFileSync(log, "");
  if (options.codex !== false) {
    write(join(stubs, "codex"), `#!/bin/sh\necho "codex $*" >> "${log}"\n`, 0o755);
  }
  const env = { HOME: home, CODEX_HOME: codexHome, PATH: `${stubs}:/usr/bin:/bin` };
  const data = join(codexHome, "plugins", "data", "squeal-hearsay");
  return { home, plugin, data, env, calls: () => readFileSync(log, "utf8") };
}

async function update(m: ReturnType<typeof machine>, deps: UpdateDeps) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd: m.home,
    env: m.env,
  };
  const code = await updateCommand([], io, deps);
  return { code, stdout, stderr };
}

describe("squeal update with the fixed Codex plugin (002-34)", () => {
  it("updates the adapter through Codex and the runtime through Squeal, reported apart", async () => {
    const m = machine();
    const s = server(release(NEXT));
    const r = await update(m, { codexRuntime: { transport: s.transport } });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(m.calls()).toBe("codex plugin marketplace upgrade hearsay\n");
    expect(r.stdout).toBe(
      [
        "$ codex plugin marketplace upgrade hearsay",
        "Codex: squeal@hearsay adapter 1.0.0, up to date",
        `Codex runtime ${NEXT}, was ${SEED}`,
        "A running session keeps the version it loaded until it restarts.",
        "",
      ].join("\n"),
    );
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: NEXT });
    const again = await update(m, { codexRuntime: { transport: s.transport } });
    expect(again.stdout).toContain(`Codex runtime ${NEXT}, up to date\n`);
  });

  it("exits 1 when the runtime update fails, and the selected runtime stays", async () => {
    const m = machine();
    selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "s-1" });
    const r = await update(m, { codexRuntime: { transport: async () => answer(503, null) } });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(`Codex runtime ${SEED}, not updated\n`);
    expect(r.stdout).not.toContain("A running session keeps");
    expect(r.stderr).toMatch(
      new RegExp(
        `^squeal update: Codex runtime: GET \\S+ answered 503 \\(http, transient\\); Codex runtime ${SEED} stays selected\n$`,
      ),
    );
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: SEED });
  });

  it("updates the runtime when Codex itself is not on the PATH", async () => {
    const m = machine({ codex: false });
    const s = server(release(NEXT));
    const r = await update(m, { codexRuntime: { transport: s.transport } });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      `Codex runtime ${NEXT}, was ${SEED}\nA running session keeps the version it loaded until it restarts.\n`,
    );
  });
});

describe("the launcher squeal update copies for the fixed Codex plugin (002-34)", () => {
  /** A user launcher of format 7, the seed's of format 8, the adapter's own of format 10. */
  function launchers() {
    const m = machine();
    const target = join(m.home, ".local", "bin", "squeal");
    write(target, launcher(7), 0o755);
    write(join(m.plugin, "bin", "squeal-launcher"), launcher(10), 0o755);
    const seed = join(m.plugin, "seed");
    write(join(seed, "bin", "squeal-launcher"), launcher(8), 0o755);
    writeManifest(seed, SEED);
    return { ...m, target };
  }
  const nothingNewer = { codexRuntime: { transport: server(release(SEED)).transport } };

  it("copies the seed's launcher before any runtime is selected", async () => {
    const m = launchers();
    const r = await update(m, nothingNewer);
    expect(r.stdout).toContain(`Copied the launcher (format 7, now 8) to ${m.target}\n`);
    expect(readFileSync(m.target, "utf8")).toBe(launcher(8));
  });

  it("copies the selected runtime's launcher, not the seed's or the adapter's", async () => {
    const m = launchers();
    const next = runtimeTree(NEXT);
    write(join(next, "bin", "squeal-launcher"), launcher(9), 0o755);
    writeManifest(next, NEXT);
    publishRuntime({ sourceRoot: next, data: m.data, select: true });
    const r = await update(m, nothingNewer);
    expect(r.stdout).toContain(`Copied the launcher (format 7, now 9) to ${m.target}\n`);
    expect(readFileSync(m.target, "utf8")).toBe(launcher(9));
  });

  it("copies none over a selection that is incomplete or unreadable", async () => {
    const m = launchers();
    selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: null });
    rmSync(join(m.data, "versions", SEED, "dist", "runtime.mjs"));
    // The update reselects nothing newer: the seed is the same version as the broken copy.
    const broken = await update(m, nothingNewer);
    expect(broken.stdout).not.toContain("Copied the launcher");
    writeFileSync(join(m.data, "runtime", "current.json"), "not json\n");
    const unreadable = await update(m, nothingNewer);
    expect(unreadable.stdout).not.toContain("Copied the launcher");
    expect(readFileSync(m.target, "utf8")).toBe(launcher(7));
  });
});
