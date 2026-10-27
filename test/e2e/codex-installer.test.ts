import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { gitMarket } from "./codex-market.js";
import { CODEX_AVAILABLE, shippedMachine, VERSION, write } from "./codex-shipped-fixture.js";

describe.skipIf(!CODEX_AVAILABLE)("real fixed-plugin installer provisioning (002-33)", () => {
  it("reports failed provisioning, then provisions the real seed/current CLI on rerun", {
    timeout: 60_000,
  }, async () => {
    const m = shippedMachine();
    let hub: Awaited<ReturnType<typeof gitMarket>> | undefined;
    try {
      hub = await gitMarket(m.base, m.market, m.env);
      // Restrict harness discovery to the real Codex CLI, without loading other harnesses.
      const tools = join(m.base, "tools");
      mkdirSync(tools);
      symlinkSync(process.execPath, join(tools, "node"));
      const nodeCodex = join(dirname(process.execPath), "codex");
      const codex =
        process.env.SQUEAL_E2E_CODEX_BIN ??
        (existsSync(nodeCodex)
          ? nodeCodex
          : execFileSync("which", ["codex"], { encoding: "utf8" }).trim());
      symlinkSync(codex, join(tools, "codex"));
      const env = {
        PATH: `${tools}:/usr/bin:/bin`,
        SQUEAL_MARKETPLACE: hub.url,
        SQUEAL_BIN_DIR: join(m.home, ".local/bin"),
      };
      // Allows testing a parent-owned integration correction without editing product files.
      const revision = process.env.SQUEAL_E2E_INSTALLER_COMMIT;
      const source =
        revision === undefined
          ? readFileSync(join(REPO_ROOT, "install.sh"), "utf8")
          : execFileSync("git", ["show", `${revision}:install.sh`], {
              cwd: REPO_ROOT,
              encoding: "utf8",
            });
      expect(source).toContain(`SQUEAL_VERSION=${VERSION}\n`);
      const script = join(m.base, "install.sh");
      write(script, source);
      const failed = m.run("sh", [script], env);
      expect(failed.status, failed.stdout + failed.stderr).toBe(1);
      expect(failed.stderr).toContain(`installing Squeal runtime ${VERSION} for Codex failed`);
      expect(failed.stdout).not.toContain("Next, in each repository");
      expect(JSON.parse(readFileSync(join(m.data, "runtime/current.json"), "utf8"))).toMatchObject({
        version: VERSION,
      });
      m.release(VERSION);
      const success = m.run("sh", [script], env);
      expect(success.status, success.stderr).toBe(0);
      expect(success.stdout).toContain("Next, in each repository: squeal setup");
      const terminal = join(m.home, ".local/bin/squeal");
      expect(m.run(terminal, ["--version"]).stdout).toBe(`${VERSION}\n`);
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
        selected: VERSION,
      });
      console.log(
        "002-33 installer evidence",
        JSON.stringify({
          installer: revision ?? "worktree",
          failureExit: failed.status,
          successExit: success.status,
          requests: m.fetches(),
        }),
      );
    } finally {
      await hub?.close();
      m.dispose();
    }
  });
});
