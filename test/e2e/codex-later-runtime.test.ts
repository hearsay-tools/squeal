import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { CODEX_AVAILABLE, tree } from "./codex-shipped-fixture.js";

const PROOFS = [
  "test/e2e/codex-fixed-plugin.test.ts",
  "test/e2e/codex-installer.test.ts",
  "test/e2e/codex-migration.test.ts",
];

describe.skipIf(!CODEX_AVAILABLE)("ordinary later Codex runtime release (002-39)", () => {
  it("passes the shipped proofs with an unchanged older seed and adapter", {
    timeout: 120_000,
  }, () => {
    const scratch = mkdtempSync("/tmp/squeal-later-runtime-");
    try {
      // Shared objects and installed dependencies only. No build writes into the source checkout.
      execFileSync("git", ["clone", "--shared", "--quiet", "--no-checkout", REPO_ROOT, scratch]);
      const commit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).trim();
      execFileSync("git", ["checkout", "--quiet", commit], { cwd: scratch });
      symlinkSync(join(REPO_ROOT, "node_modules"), join(scratch, "node_modules"), "dir");
      // Exercise this worktree's proof edits before commit too; product inputs remain committed.
      for (const path of ["test/e2e/codex-shipped-fixture.ts", ...PROOFS]) {
        copyFileSync(join(REPO_ROOT, path), join(scratch, path));
      }
      const fixed = join(scratch, "plugins/codex");
      const before = tree(fixed);
      const pkgPath = join(scratch, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
      const later = pkg.version.replace(/\d+$/, (patch) => String(Number(patch) + 1));
      const installer = join(scratch, "install.sh");
      const script = readFileSync(installer, "utf8");
      expect(script).toContain(`SQUEAL_VERSION=${pkg.version}\n`);
      writeFileSync(
        installer,
        script.replace(`SQUEAL_VERSION=${pkg.version}\n`, `SQUEAL_VERSION=${later}\n`),
      );
      pkg.version = later;
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      execFileSync("pnpm", ["exec", "tsx", "src/harness/codex/build.ts"], {
        cwd: scratch,
        timeout: 60_000,
      });
      expect(tree(fixed)).toEqual(before);
      const runtime = JSON.parse(
        readFileSync(join(scratch, "plugins/codex-runtime/runtime.json"), "utf8"),
      );
      const seed = JSON.parse(readFileSync(join(fixed, "seed/runtime.json"), "utf8"));
      expect(runtime.version).toBe(later);
      expect(runtime.version).not.toBe(seed.version);
      const result = spawnSync(
        "pnpm",
        ["exec", "vitest", "run", ...PROOFS, "--maxWorkers=1", "--reporter=verbose"],
        {
          cwd: scratch,
          encoding: "utf8",
          env: {
            ...process.env,
            SQUEAL_E2E_INSTALLER_COMMIT: undefined,
            NO_COLOR: "1",
            FORCE_COLOR: undefined,
          },
          timeout: 60_000,
        },
      );
      console.log("002-39 later-runtime proof", result.stdout);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toMatch(/Tests\s+3 passed/);
      expect(result.stdout).not.toContain("skipped");
      expect(tree(fixed)).toEqual(before);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
