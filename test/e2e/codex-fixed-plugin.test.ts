import { existsSync, readFileSync, rmSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { pinFile } from "../../src/harness/codex/adapter/layout.js";
import {
  RUNTIME_ARTIFACT_ASSET,
  releaseAssetUrl,
} from "../../src/harness/codex/runtime-release/index.js";
import { appServer } from "./codex-app-server.js";
import {
  ADAPTER_VERSION,
  CODEX_AVAILABLE,
  CURRENT_VERSION,
  NEXT_VERSION,
  SEED_VERSION,
  shippedMachine,
  tree,
} from "./codex-shipped-fixture.js";

describe.skipIf(!CODEX_AVAILABLE)("fixed shipped Codex plugin (002-33, D7–D9)", () => {
  it("bootstraps offline on a real first turn, preserves approvals across publication, and pins sessions", {
    timeout: 60_000,
  }, async () => {
    const m = shippedMachine();
    let server: Awaited<ReturnType<typeof appServer>> | undefined;
    try {
      const market = m.run("codex", ["plugin", "marketplace", "add", m.market]);
      expect(market.status, market.stderr).toBe(0);
      const install = m.run("codex", ["plugin", "add", "squeal@hearsay"]);
      expect(install.status, install.stderr).toBe(0);
      const original = tree(m.plugin);
      const trust = m.cli(["init", "--harness", "codex", "--trust", "--yes"]);
      expect(trust.status, trust.stderr).toBe(0);
      server = await appServer(m.repo, m.env);
      const approved = await server.hooks();
      expect(approved).toHaveLength(10);
      expect(approved.every((h) => h.trustStatus === "trusted")).toBe(true);
      const first = await server.thread();
      expect(existsSync(pinFile(m.data, first))).toBe(false);
      expect(existsSync(join(m.data, "versions", SEED_VERSION))).toBe(false);
      const started = performance.now();
      await server.turn(first);
      const coldMs = performance.now() - started;
      const coldHooks = server.notifications
        .filter((n) => n.method === "hook/completed")
        .map((n) => n.params.run as { eventName: string; status: string; durationMs: number });
      expect(coldHooks.find((h) => h.eventName === "sessionStart")).toMatchObject({
        status: "completed",
      });
      expect(coldHooks.find((h) => h.eventName === "sessionStart")?.durationMs).toBeLessThan(2000);
      const firstPin = readFileSync(pinFile(m.data, first), "utf8");
      expect(JSON.parse(firstPin)).toMatchObject({ sessionId: first, version: SEED_VERSION });
      expect(m.fetches()).toEqual([]);
      expect(existsSync(join(m.data, "versions", SEED_VERSION, "skills/squeal/SKILL.md"))).toBe(
        true,
      );
      expect(tree(join(m.data, "versions", SEED_VERSION), true)).toEqual(
        tree(join(m.plugin, "seed"), true),
      );
      const config = readFileSync(join(m.codexHome, "config.toml"), "utf8");

      // Provision the real built release first, even when it is newer than the frozen seed.
      const currentTag = m.release();
      const provision = m.cli([
        "codex-runtime",
        "update",
        "--plugin-root",
        m.plugin,
        "--tag",
        currentTag,
      ]);
      expect(provision.status, provision.stderr).toBe(0);
      expect(provision.stdout).toContain(CURRENT_VERSION);
      const currentSession = await server.thread();
      await server.turn(currentSession);
      expect(JSON.parse(readFileSync(pinFile(m.data, currentSession), "utf8"))).toMatchObject({
        version: CURRENT_VERSION,
      });
      const launcher = join(m.data, "bin/squeal");
      expect(m.run(launcher, ["--version"], { CODEX_SESSION_ID: currentSession }).stdout).toBe(
        `${CURRENT_VERSION}\n`,
      );
      expect(tree(join(m.data, "versions", CURRENT_VERSION), true)).toEqual(
        tree(join(REPO_ROOT, "plugins/codex-runtime"), true),
      );
      if (CURRENT_VERSION !== SEED_VERSION) {
        expect(m.fetches()).toContain(releaseAssetUrl(currentTag, RUNTIME_ARTIFACT_ASSET));
      }
      const tag = m.release(NEXT_VERSION);
      const update = m.cli(["codex-runtime", "update", "--plugin-root", m.plugin, "--tag", tag]);
      expect(update.status, update.stderr).toBe(0);
      expect(update.stdout).toContain(NEXT_VERSION);
      expect(tree(m.plugin)).toEqual(original);
      expect(readFileSync(join(m.codexHome, "config.toml"), "utf8")).toBe(config);
      expect(await server.hooks()).toEqual(approved);
      const fresh = await appServer(m.repo, m.env);
      try {
        expect(await fresh.hooks()).toEqual(approved);
      } finally {
        await fresh.close();
      }
      expect(readFileSync(pinFile(m.data, first), "utf8")).toBe(firstPin);
      await server.turn(first);
      expect(readFileSync(pinFile(m.data, first), "utf8")).toBe(firstPin);
      const second = await server.thread();
      await server.turn(second);
      expect(JSON.parse(readFileSync(pinFile(m.data, second), "utf8"))).toMatchObject({
        version: NEXT_VERSION,
      });
      expect(m.run(launcher, ["--version"], { CODEX_SESSION_ID: currentSession }).stdout).toBe(
        `${CURRENT_VERSION}\n`,
      );
      expect(m.run(launcher, ["--version"], { CODEX_SESSION_ID: first }).stdout).toBe(
        `${SEED_VERSION}\n`,
      );
      expect(m.run(launcher, ["--version"], { CODEX_SESSION_ID: second }).stdout).toBe(
        `${NEXT_VERSION}\n`,
      );
      rmSync(join(m.data, "versions", SEED_VERSION), { recursive: true });
      const missing = m.run(launcher, ["--version"], { CODEX_SESSION_ID: first });
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain("Start a new Codex session");
      const from = server.notifications.length;
      await server.turn(first);
      expect(JSON.stringify(server.notifications.slice(from))).toContain("validation unavailable");
      expect(tree(m.plugin)).toEqual(original);
      console.log(
        "002-33 live evidence",
        JSON.stringify({
          adapter: ADAPTER_VERSION,
          seed: SEED_VERSION,
          current: CURRENT_VERSION,
          syntheticNext: NEXT_VERSION,
          coldMs,
          load: loadavg()[0],
          coldHooks: coldHooks.map(({ eventName, status, durationMs }) => ({
            eventName,
            status,
            durationMs,
          })),
          pluginFiles: Object.keys(original).length,
          trustedBefore: approved.length,
          trustedAfter: (await server.hooks()).filter((h) => h.trustStatus === "trusted").length,
          oldSessionCli: SEED_VERSION,
          newSessionCli: NEXT_VERSION,
          missingPinCliExit: missing.status,
          missingPinHookDiagnostic: true,
          requests: m.fetches(),
        }),
      );
    } finally {
      await server?.close();
      m.dispose();
    }
  });
});
