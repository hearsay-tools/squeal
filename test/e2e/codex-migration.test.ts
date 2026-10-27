import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import {
  RUNTIME_ARTIFACT_ASSET,
  releaseAssetUrl,
} from "../../src/harness/codex/runtime-release/index.js";
import { gitMarket } from "./codex-market.js";
import {
  ADAPTER_VERSION,
  CODEX_AVAILABLE,
  CURRENT_VERSION,
  SEED_VERSION,
  shippedMachine,
  tree,
} from "./codex-shipped-fixture.js";
import { copyPlugin } from "./plugins.js";

describe.skipIf(!CODEX_AVAILABLE)("released format-7 migration (002-33)", () => {
  it("runs released 0.1.367 update through real Codex, then provisions with the shipped CLI", {
    timeout: 60_000,
  }, async () => {
    const m = shippedMachine();
    let hub: Awaited<ReturnType<typeof gitMarket>> | undefined;
    try {
      const source = join(m.market, "plugins/codex");
      rmSync(source, { recursive: true });
      const archive = execFileSync("git", ["archive", "squeal--v0.1.367", "plugins/codex"], {
        cwd: REPO_ROOT,
        maxBuffer: 64 * 1024 * 1024,
      });
      const unpack = spawnSync("tar", ["-xf", "-", "-C", m.market], { input: archive });
      expect(unpack.status).toBe(0);
      hub = await gitMarket(m.base, m.market, m.env);
      const market = m.run("codex", ["plugin", "marketplace", "add", hub.url]);
      expect(market.status, market.stderr).toBe(0);
      const install = m.run("codex", ["plugin", "add", "squeal@hearsay"]);
      expect(install.status, install.stderr).toBe(0);
      const terminal = join(m.home, ".local/bin/squeal");
      mkdirSync(join(m.home, ".local/bin"), { recursive: true });
      copyFileSync(join(source, "bin/squeal-launcher"), terminal);
      chmodSync(terminal, 0o755);
      expect(readFileSync(terminal, "utf8")).toContain("# squeal-launcher format 7");
      expect(m.run(terminal, ["--version"]).stdout).toBe("0.1.367\n");
      rmSync(source, { recursive: true });
      copyPlugin("codex", source);
      hub.publish();
      const upgrade = m.run(terminal, ["update"]);
      expect(upgrade.status, upgrade.stderr + upgrade.stdout).toBe(0);
      expect(upgrade.stdout).toContain("Copied the launcher (format 7, now 8)");
      expect(readFileSync(terminal, "utf8")).toContain("# squeal-launcher format 8");
      expect(m.run(terminal, ["--version"]).stdout).toBe(`${SEED_VERSION}\n`);
      expect(existsSync(join(m.plugin, "seed/dist/cli/squeal.mjs"))).toBe(true);
      const ensured = m.cli(["codex-runtime", "ensure", "--plugin-root", m.plugin]);
      expect(ensured.status, ensured.stderr).toBe(0);
      const status = m.run(terminal, [
        "codex-runtime",
        "status",
        "--plugin-root",
        m.plugin,
        "--json",
      ]);
      expect(status.status, status.stderr).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({
        adapterValid: true,
        selected: SEED_VERSION,
      });
      expect(m.fetches()).toEqual([]);
      const original = tree(m.plugin);
      const tag = m.release();
      const update = m.cli(["codex-runtime", "update", "--plugin-root", m.plugin, "--tag", tag]);
      expect(update.status, update.stderr).toBe(0);
      expect(update.stdout).toContain(CURRENT_VERSION);
      expect(m.run(terminal, ["--version"]).stdout).toBe(`${CURRENT_VERSION}\n`);
      const provisioned = m.run(terminal, [
        "codex-runtime",
        "status",
        "--plugin-root",
        m.plugin,
        "--json",
      ]);
      expect(provisioned.status, provisioned.stderr).toBe(0);
      expect(JSON.parse(provisioned.stdout)).toMatchObject({
        adapterValid: true,
        selected: CURRENT_VERSION,
      });
      expect(tree(m.plugin)).toEqual(original);
      expect(tree(join(m.data, "versions", CURRENT_VERSION), true)).toEqual(
        tree(join(REPO_ROOT, "plugins/codex-runtime"), true),
      );
      if (CURRENT_VERSION !== SEED_VERSION) {
        expect(m.fetches()).toContain(releaseAssetUrl(tag, RUNTIME_ARTIFACT_ASSET));
      }
      console.log(
        "002-33 migration evidence",
        upgrade.stdout.trim(),
        JSON.stringify({
          adapter: ADAPTER_VERSION,
          seed: SEED_VERSION,
          current: CURRENT_VERSION,
          artifactDownloaded: m.fetches().includes(releaseAssetUrl(tag, RUNTIME_ARTIFACT_ASSET)),
          requests: m.fetches(),
        }),
      );
    } finally {
      await hub?.close();
      m.dispose();
    }
  });
});
