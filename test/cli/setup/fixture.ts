import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { CliIo } from "../../../src/cli/main.js";
import { git, initRepo } from "../../hash/git-repo.js";

/* Fixtures for `squeal setup` (row 005-12): real git repositories, read as text only. */

const cleanups: (() => void)[] = [];

/** Removes every directory the fixtures made; call from `afterEach`. */
export function cleanupFixtures(): void {
  for (const cleanup of cleanups.splice(0)) cleanup();
}

/**
 * A directory under `/tmp`, not `TMPDIR`: Claude Code reads `CLAUDE.md` above
 * the root too (D4), and a session's `TMPDIR` may sit inside a checkout that has one.
 */
export function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join("/tmp", prefix)));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The gate line of this repository's `CLAUDE.md` before `97144d9`. */
export const VITEST_GATE =
  "Verification: `npm run lint`, `npm run typecheck`, `npm run build`, and `npx vitest run`. Paste the output in your final message.";

/**
 * A repository shaped like this one at `2513bbdc` (`research/wave-0-checks.md`
 * 7): a root package with `bin` and `files` naming `dist` and `plugins`, a
 * `tsc` build into the gitignored `dist`, the bundles under `plugins/*\/dist`
 * tracked, e2e tests naming both, `AGENTS.md -> CLAUDE.md`, and a config with
 * e2e `inputs` and no `slow` key. `files` adds or replaces files; an
 * `AGENTS.md` among them replaces the symlink.
 */
export function squealShaped(files: Readonly<Record<string, string>> = {}): string {
  const root = scratch("squeal-setup-");
  initRepo(root, {
    "package.json": json({
      name: "squeal",
      bin: { squeal: "dist/cli/index.js" },
      files: ["dist", "plugins", "README.md"],
      scripts: {
        build: "tsc -p tsconfig.build.json && npm run build:plugin",
        "build:plugin": "tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts",
        test: "vitest run",
      },
      devDependencies: { vitest: "^3.0.0" },
    }),
    "tsconfig.build.json": json({ compilerOptions: { outDir: "dist" } }),
    "vitest.config.ts": `export default { test: { include: ["test/**/*.test.ts", "src/**/*.test.ts"], exclude: ["test/fixtures/**", "node_modules/**"] } };\n`,
    ".gitignore": "node_modules/\ndist/\n",
    "CLAUDE.md": `# Agents\n\n${VITEST_GATE}\n`,
    "src/cli/index.ts": "export {};\n",
    "plugins/claude-code/dist/cli/squeal.mjs": "\n",
    "plugins/codex/dist/cli/squeal.mjs": "\n",
    "test/e2e/plugin-copy.test.ts": `const a = "plugins/codex/dist/cli/squeal.mjs";\nconst b = "dist/cli/squeal.mjs";\n`,
    "test/e2e/shipped-plugin.test.ts": `const bundle = "dist/cli/squeal.mjs";\n`,
    "test/e2e/helpers.ts": "export {};\n",
    "test/cli/main.test.ts": "\n",
    "test/fixtures/e2e/project/test/math.test.ts": "\n",
    "squeal.config.json": json({
      inputs: { "test/e2e/*.test.ts": ["plugins/claude-code/**", "plugins/codex/**"] },
    }),
    ".claude/skills/worker/SKILL.md": "Run `npx vitest run` and paste it.\n",
    ...files,
  });
  // The bundles are committed past the `dist/` ignore, as here.
  git(root, ["add", "-f", "plugins"]);
  git(root, ["commit", "-q", "-m", "bundles"]);
  if (!("AGENTS.md" in files)) {
    symlinkSync("CLAUDE.md", join(root, "AGENTS.md"));
    git(root, ["add", "AGENTS.md"]);
    git(root, ["commit", "-q", "-m", "agents"]);
  }
  return root;
}

/**
 * `squealShaped` e2e files that name no build output, so `test/e2e` is a slow
 * candidate and not an exclude candidate (row 005-70): the plugin-copy test
 * names `plugins/codex/dist`, which the `dist/` rule ignores though git tracks it.
 */
export const SLOW_ONLY_E2E: Readonly<Record<string, string>> = {
  "test/e2e/plugin-copy.test.ts": `const a = "src/cli/index.ts";\n`,
  "test/e2e/shipped-plugin.test.ts": "\n",
};

/**
 * `squealShaped` e2e files that both name the committed bundle, so the whole
 * group is evidenced and its exclude proposal is `test/e2e/**` (wave 13 B1:
 * `squealShaped`'s own `shipped-plugin` names none, and stays a slow candidate).
 */
export const ALL_NAMED_E2E: Readonly<Record<string, string>> = {
  "test/e2e/shipped-plugin.test.ts": `const bundle = "plugins/codex/dist/cli/squeal.mjs";\n`,
};

/**
 * Cezarion at `c07b0bf`, reduced: the same scripts, manifest fields and test
 * strings. `files` adds or replaces files, as `squealShaped` takes them.
 */
export function cezarionShaped(files: Readonly<Record<string, string>> = {}): string {
  const root = scratch("squeal-setup-cezarion-");
  const unit = "node --import tsx --test test/unit/*.test.ts";
  initRepo(root, {
    "package.json": json({
      private: true,
      workspaces: ["packages/*"],
      scripts: {
        test: "vitest run",
        "test:e2e": "sh .ai/scripts/e2e.sh",
        "test:package": "npm run test:package -w @wjarka/cezar",
      },
      devDependencies: { vitest: "^3.0.0" },
    }),
    ".gitignore": "node_modules/\ndist/\n",
    "packages/cezar/package.json": json({
      name: "@wjarka/cezar",
      bin: { cezar: "./dist/cli.js" },
      exports: { ".": "./dist/index.js" },
      files: ["dist", "web/dist", "scripts"],
      scripts: {
        build: "tsc -p tsconfig.json",
        "test:unit": unit,
        "test:package": "node --import tsx --test test/e2e/*.test.ts",
      },
    }),
    "packages/cezar/tsconfig.json": `{\n  // comments, as tsc allows\n  "compilerOptions": { "outDir": "./dist" }\n}\n`,
    "packages/cezar/scripts/release.sh": "\n",
    "packages/cezar/test/e2e/update.test.ts": `import("../../dist/application-update/service.js");\n`,
    "packages/cezar/test/e2e/package-cli.test.ts": `expect(files).toContain("web/dist/index.html");\n`,
    "packages/cezar/test/unit/a.test.ts": "\n",
    "packages/cezar/src/workflows/monitoring-turn.test.ts": "\n",
    ...files,
  });
  mkdirSync(join(root, "packages/cezar/dist"), { recursive: true });
  return root;
}

/** The pytest projects of `toolkitShaped`'s config: the root's `testpaths` covers `plugin-tools`. */
export const TOOLKIT_PYTEST = [
  { name: "root", include: ["tests/**/test_*.py", "plugin-tools/**/test_*.py"] },
  { name: "plugin-tools-a", cwd: "plugin-tools/a", include: ["tests/**/test_*.py"] },
];

/**
 * toolkit-dev at session c92fddaf (rows 005-79 and 005-80), reduced: a root
 * `package.json` with scripts only, whose `test:node` chains `node --test`
 * into a Vitest below the root; a root pytest project whose `testpaths`
 * covers a nested one; a config with `"nodeTest": []` and both pytest
 * projects. `files` adds or replaces files, as `squealShaped` takes them.
 */
export function toolkitShaped(files: Readonly<Record<string, string>> = {}): string {
  const root = scratch("squeal-setup-toolkit-");
  initRepo(root, {
    "package.json": json({
      name: "toolkit",
      private: true,
      scripts: {
        "test:node":
          "node --test .github/scripts/*.test.js && npm --prefix tools/generator run test",
      },
    }),
    ".gitignore": "node_modules/\n",
    ".github/scripts/release.test.js": "\n",
    "tools/generator/package.json": json({
      name: "generator",
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "^3.0.0" },
    }),
    "tools/generator/vitest.config.ts": "export default {};\n",
    "tools/generator/src/render.test.ts": "\n",
    "pyproject.toml": '[tool.pytest.ini_options]\ntestpaths = ["tests", "plugin-tools"]\n',
    "tests/test_root.py": "\n",
    "plugin-tools/a/pyproject.toml": '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
    "plugin-tools/a/tests/test_one.py": "\n",
    "plugin-tools/a/tests/test_two.py": "\n",
    "squeal.config.json": json({ nodeTest: [], pytest: TOOLKIT_PYTEST }),
    ...files,
  });
  return root;
}

/** An environment with a scratch HOME, the named harness CLIs on PATH and nothing else. */
export function harnessEnv(
  harnesses: readonly ("claude" | "codex")[] = [],
): Record<string, string> {
  const home = scratch("squeal-setup-home-");
  const bin = join(home, "bin");
  mkdirSync(bin);
  for (const name of harnesses) {
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, name), 0o755);
  }
  return { HOME: home, PATH: bin };
}

export function capture(cwd: string, env: Record<string, string> = harnessEnv()) {
  const out = { stdout: "", stderr: "" };
  const io: CliIo = {
    stdout: (text) => {
      out.stdout += text;
    },
    stderr: (text) => {
      out.stderr += text;
    },
    cwd,
    env,
  };
  return { io, out };
}
