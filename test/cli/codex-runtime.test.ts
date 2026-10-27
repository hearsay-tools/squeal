import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CodexRuntimeDeps,
  codexAdapterRoot,
  codexRuntimeCommand,
  codexRuntimeData,
} from "../../src/cli/codex/runtime.js";
import { type CliIo, main } from "../../src/cli/main.js";
import { readCurrent, sessionsDir } from "../../src/harness/codex/adapter/layout.js";
import { selectRuntime } from "../../src/harness/codex/adapter/store.js";
import { readUpdateState } from "../../src/harness/codex/runtime-update/index.js";
import { write } from "../harness/codex/adapter/fixture.js";
import {
  answer,
  machine,
  NEXT,
  release,
  SEED,
  server,
} from "../harness/codex/runtime-update/fixture.js";
import { tempDir } from "../store/helpers.js";

/*
 * Row 002-34 (spec 002 D7 and D8, `wave-5-contract.md`): `squeal
 * codex-runtime ensure|update|status`, the contract the installer, the
 * launcher and the SessionStart trigger call. Updates use an injected
 * transport; nothing reaches a real endpoint.
 */

async function run(args: string[], env: Record<string, string> = {}, deps?: CodexRuntimeDeps) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    env,
  };
  const code = await (deps === undefined
    ? main(["codex-runtime", ...args], io)
    : codexRuntimeCommand(args, io, deps));
  return { code, stdout, stderr };
}

const at = (m: ReturnType<typeof machine>) => ["--plugin-root", m.plugin, "--data", m.data];

describe("squeal codex-runtime ensure (002-34)", () => {
  it("selects the seed with no network and no pin, then keeps the current runtime", async () => {
    const m = machine();
    const first = await run(["ensure", ...at(m)]);
    expect(first).toEqual({
      code: 0,
      stdout: `Codex runtime ${SEED} ready (seed) in ${join(m.data, "versions", SEED)}\n`,
      stderr: "",
    });
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: SEED });
    expect(existsSync(sessionsDir(m.data))).toBe(false);
    expect((await run(["ensure", ...at(m)])).stdout).toContain("ready (current)");
  });

  it("exits 1 with the reason when no complete runtime exists, or the root is no adapter", async () => {
    const m = machine();
    rmSync(join(m.plugin, "seed", "dist", "runtime.mjs"));
    const broken = await run(["ensure", ...at(m)]);
    expect(broken.code).toBe(1);
    expect(broken.stderr).toContain("No usable Squeal runtime");
    expect(readCurrent(m.data)).toBeNull();
    const retained = await run(["ensure", "--plugin-root", join(m.plugin, "seed")]);
    expect(retained.code).toBe(1);
    expect(retained.stderr).toContain("has no hooks/hooks.json and seed/");
  });

  it("finds the data directory from --data, PLUGIN_DATA, then CODEX_HOME", async () => {
    const home = tempDir("squeal-codex-home-");
    expect(codexRuntimeData({ CODEX_HOME: home })).toBe(
      join(home, "plugins", "data", "squeal-hearsay"),
    );
    expect(codexRuntimeData({ HOME: home })).toBe(
      join(home, ".codex", "plugins", "data", "squeal-hearsay"),
    );
    expect(codexRuntimeData({ CODEX_HOME: home, PLUGIN_DATA: "/d" })).toBe("/d");
    const m = machine();
    const r = await run(["ensure", "--plugin-root", m.plugin], { CODEX_HOME: home });
    expect(r.code).toBe(0);
    expect(readCurrent(join(home, "plugins", "data", "squeal-hearsay"))).toEqual({
      schema: 1,
      version: SEED,
    });
  });

  it("finds the installed adapter, never a retained runtime or a plugin from before it", () => {
    const home = tempDir("squeal-codex-home-");
    const cache = join(home, "plugins", "cache", "hearsay", "squeal");
    expect(codexAdapterRoot({ CODEX_HOME: home })).toBeNull();
    write(join(cache, "0.1.366", ".codex-plugin", "plugin.json"), "{}\n");
    write(join(cache, "0.1.366", "hooks", "hooks.json"), "{}\n");
    expect(codexAdapterRoot({ CODEX_HOME: home })).toBeNull();
    const m = machine();
    expect(codexAdapterRoot({ CODEX_HOME: home, SQUEAL_ADAPTER_ROOT: m.plugin })).toBe(m.plugin);
    write(join(cache, "1.0.0", "hooks", "hooks.json"), "{}\n");
    write(join(cache, "1.0.0", "seed", "runtime.json"), "{}\n");
    const env = { CODEX_HOME: home, SQUEAL_ADAPTER_ROOT: join(m.plugin, "seed") };
    expect(codexAdapterRoot(env)).toBe(join(cache, "1.0.0"));
  });
});

describe("squeal codex-runtime update (002-34)", () => {
  it("reports an update in the foreground and exits 0", async () => {
    const m = machine();
    const s = server(release(NEXT));
    const r = await run(["update", ...at(m)], {}, { transport: s.transport });
    expect(r).toEqual({
      code: 0,
      stdout: `Codex runtime ${NEXT}, was ${SEED} (release squeal--v${NEXT}); new Codex sessions use it, running ones keep theirs\n`,
      stderr: "",
    });
    const again = await run(["update", ...at(m)], {}, { transport: s.transport });
    expect(again.stdout).toBe(
      `Codex runtime ${NEXT}, up to date: release squeal--v${NEXT} is not newer\n`,
    );
  });

  it("exits 1 on a failure, and the selected runtime stays", async () => {
    const m = machine();
    await run(["ensure", ...at(m)]);
    const r = await run(["update", ...at(m)], {}, { transport: async () => answer(503, null) });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(
      new RegExp(
        `^squeal codex-runtime update: GET \\S+ answered 503 \\(http, transient\\); Codex runtime ${SEED} stays selected\n$`,
      ),
    );
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: SEED });
  });

  it("runs in the background silently, keeps the retry delay, and records its state", async () => {
    const m = machine();
    const s = server(release(NEXT));
    const background = ["update", ...at(m), "--background"];
    expect(await run(background, {}, { transport: s.transport })).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
    expect(readUpdateState(m.data)).toMatchObject({ outcome: "updated", selected: NEXT });
    s.requests.length = 0;
    expect(await run(background, {}, { transport: s.transport })).toMatchObject({ code: 0 });
    expect(s.requests).toEqual([]);
    const failing = machine();
    const r = await run(
      ["update", ...at(failing), "--background"],
      {},
      {
        transport: async () => answer(503, null),
      },
    );
    expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(readUpdateState(failing.data)).toMatchObject({ outcome: "failed" });
  });

  it("takes an exact tag", async () => {
    const m = machine();
    const s = server(release(NEXT), release("0.1.903"));
    const r = await run(
      ["update", ...at(m), "--tag", `squeal--v${NEXT}`],
      {},
      {
        transport: s.transport,
      },
    );
    expect(r.code).toBe(0);
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: NEXT });
    expect(s.requests.some((u) => u.includes("releases/latest"))).toBe(false);
  });
});

describe("squeal codex-runtime status (002-34)", () => {
  it("reports adapter and runtime versions, pins and the last check, and exits 0 when ready", async () => {
    const m = machine();
    const fresh = await run(["status", ...at(m)]);
    expect(fresh.code).toBe(0);
    expect(fresh.stdout).toBe(
      [
        `Codex adapter 1.0.0 at ${m.plugin}`,
        `Codex runtime ${SEED}: ready; new Codex sessions use it`,
        "  current: none, not ready: no runtime is selected",
        `  seed: ${SEED}, ready`,
        "  sessions: none pinned",
        "Update check: none yet",
        "",
      ].join("\n"),
    );
    selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "s-1" });
    await run(["update", ...at(m)], {}, { transport: async () => answer(503, null) });
    const json = JSON.parse((await run(["status", ...at(m), "--json"])).stdout);
    expect(json).toMatchObject({
      schema: 1,
      ready: true,
      adapterValid: true,
      data: m.data,
      adapter: { root: m.plugin, version: "1.0.0" },
      selected: SEED,
      current: { version: SEED, ready: true },
      pinned: [{ version: SEED, ready: true }],
      update: { outcome: "failed", failure: { code: "http", transient: true } },
    });
    const text = (await run(["status", ...at(m)])).stdout;
    expect(text).toContain(`  sessions pinned to: ${SEED}\n`);
    expect(text).toMatch(/\nUpdate check: failed at \S+: GET \S+ answered 503 \(http, transient\)/);
  });

  it("exits 1 and says what to run when no runtime is ready, and names missing pins", async () => {
    const m = machine();
    selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "s-1" });
    rmSync(join(m.data, "versions", SEED), { recursive: true });
    rmSync(join(m.plugin, "seed", "dist", "runtime.mjs"));
    const r = await run(["status", ...at(m)]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      `Codex runtime: not ready; new Codex sessions report validation unavailable. Run squeal codex-runtime update --plugin-root ${m.plugin}`,
    );
    expect(r.stdout).toContain(`missing: ${SEED} (those sessions report validation unavailable`);
  });

  it("refuses bad arguments with exit 2", async () => {
    const m = machine();
    for (const args of [
      [],
      ["install", ...at(m)],
      ["ensure"],
      ["ensure", "--plugin-root", "plugin"],
      ["ensure", ...at(m), "--tag", "squeal--v0.1.1"],
      ["update", ...at(m), "--tag", "v0.1.1"],
      ["status", "--plugin-root"],
    ]) {
      const r = await run(args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.stderr, args.join(" ")).toContain("usage: squeal codex-runtime ensure");
    }
    expect((await run(["status", `--plugin-root=${m.plugin}`, `--data=${m.data}`])).code).toBe(0);
    const help = await run(["--help"]);
    expect(help.stdout).toContain("squeal codex-runtime update --plugin-root <absolute>");
  });
});
