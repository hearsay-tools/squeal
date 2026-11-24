import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { managerSpec, onPath } from "../../../src/core/runner-host/remote/package-manager.js";
import {
  type InstallPlace,
  installTree,
} from "../../../src/core/runner-host/remote/tree-install.js";
import { counted } from "./pnpm-project.js";

/*
 * Row 026-22: a remote with Node 25 or later has no corepack, so no `pnpm`
 * or `yarn`. The tree install uses a manager already on `PATH` as it is;
 * a missing one is installed once per machine with the npm beside the
 * host's Node, at the version `packageManager` names, and reused. Here npm
 * and pnpm are fakes that count their calls: no registry is asked.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-package-manager-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** An executable shell script at `path`. */
function script(path: string, lines: readonly string[]): void {
  writeFileSync(path, ["#!/bin/sh", ...lines, ""].join("\n"));
  chmodSync(path, 0o755);
}

let n = 0;
/** A pnpm project's remote tree with a fake npm, whose installed `pnpm` counts its calls. */
function setup(packageManager?: string, npmFails = false) {
  const dir = join(scratch, `s${++n}`);
  const root = join(dir, "remote", "root");
  const tools = join(dir, "tools");
  const node = join(dir, "node");
  mkdirSync(root, { recursive: true });
  mkdirSync(tools, { recursive: true });
  mkdirSync(node, { recursive: true });
  symlinkSync(process.execPath, join(node, "node"));
  const npmCalls = join(dir, "npm-calls");
  const pnpmCalls = join(dir, "pnpm-calls");
  const fakePnpm = [`echo "pnpm $*" >> ${JSON.stringify(pnpmCalls)}`, "mkdir -p node_modules/dep"];
  script(join(tools, "pnpm-template"), fakePnpm);
  script(join(tools, "npm"), [
    `echo "$*" >> ${JSON.stringify(npmCalls)}`,
    ...(npmFails ? ["echo 'npm ERR! 404 no such package' >&2", "exit 1"] : []),
    'while [ $# -gt 0 ]; do case "$1" in --prefix) P=$2; shift 2 ;; *) shift ;; esac; done',
    'mkdir -p "$P/node_modules/.bin"',
    `cp ${JSON.stringify(join(tools, "pnpm-template"))} "$P/node_modules/.bin/pnpm"`,
  ]);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "app", ...(packageManager === undefined ? {} : { packageManager }) }),
  );
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const managers = join(dir, "pm");
  const place = (blob: string, env: NodeJS.ProcessEnv): InstallPlace => ({
    root,
    record: join(dir, "remote", "installed.json"),
    locks: { "pnpm-lock.yaml": blob },
    keepModules: false,
    output: () => {},
    env,
    managers,
    tools: { nodeDir: node, npm: [join(tools, "npm")] },
  });
  /** A `PATH` without any pnpm: the system's own directories. */
  const bare = { ...process.env, PATH: "/usr/bin:/bin" };
  const npmArgs = () =>
    existsSync(npmCalls) ? readFileSync(npmCalls, "utf8").trim().split("\n") : [];
  return { dir, root, place, bare, managers, npmCalls, pnpmCalls, npmArgs };
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const INSTALLED = { ran: true, command: "pnpm install --frozen-lockfile" };

describe("a missing package manager on a remote (row 026-22)", { timeout: 30_000 }, () => {
  it("uses a pnpm already on PATH as it is, without npm", async () => {
    const s = setup("pnpm@9.15.0");
    const bin = join(s.dir, "bin");
    mkdirSync(bin);
    script(join(bin, "pnpm"), [`echo "pnpm $*" >> ${JSON.stringify(s.pnpmCalls)}`]);
    const env = { ...s.bare, PATH: `${bin}:${s.bare.PATH}` };
    expect(await installTree(s.place("a", env))).toEqual(INSTALLED);
    expect(counted(s.pnpmCalls)).toBe(1);
    expect(counted(s.npmCalls)).toBe(0);
    expect(existsSync(s.managers)).toBe(false);
  });

  it("installs the declared pnpm once into the machine's cache and reuses it", async () => {
    const s = setup("pnpm@9.15.0+sha512.0123abcdef");
    expect(onPath("pnpm", s.bare.PATH)).toBe(false);
    expect(await installTree(s.place("a", s.bare))).toEqual(INSTALLED);
    expect(counted(s.pnpmCalls)).toBe(1);
    const [args] = s.npmArgs();
    expect(args).toMatch(
      new RegExp(
        `^install --no-audit --no-fund --prefix ${literal(s.managers)}/pnpm-9\\.15\\.0\\.\\S+\\.part pnpm@9\\.15\\.0$`,
      ),
    );
    expect(readdirSync(s.managers)).toEqual(["pnpm-9.15.0"]);
    expect(existsSync(join(s.managers, "pnpm-9.15.0/node_modules/.bin/pnpm"))).toBe(true);
    // A new lockfile: installed again, with the same pnpm and no second npm.
    expect(await installTree(s.place("b", s.bare))).toEqual(INSTALLED);
    expect(counted(s.pnpmCalls)).toBe(2);
    expect(counted(s.npmCalls)).toBe(1);
  });

  it("installs the latest pnpm when packageManager is not a plain version", async () => {
    const s = setup("pnpm@9.15.0; touch pwned");
    expect(await installTree(s.place("a", s.bare))).toEqual(INSTALLED);
    expect(s.npmArgs()[0]).toMatch(/ pnpm@latest$/);
    expect(readdirSync(s.managers)).toEqual(["pnpm-latest"]);
    expect(existsSync(join(s.root, "pwned"))).toBe(false);
  });

  it("fails naming npm and leaves no copy when npm fails", async () => {
    const s = setup("pnpm@9.15.0", true);
    await expect(installTree(s.place("a", s.bare))).rejects.toThrow(
      /npm install pnpm@9\.15\.0 failed on the remote \(exit code 1\): npm ERR! 404/,
    );
    expect(readdirSync(s.managers)).toEqual([]);
    expect(counted(s.pnpmCalls)).toBe(0);
  });

  it("gives two trees installing at once one whole copy, also when repairing a broken cache", async () => {
    const a = setup("pnpm@9.15.0");
    const b = setup("pnpm@9.15.0");
    const shared = { managers: join(scratch, "shared-pm") };
    mkdirSync(join(shared.managers, "pnpm-9.15.0"), { recursive: true });
    writeFileSync(join(shared.managers, "pnpm-9.15.0", "broken"), "incomplete");
    const answers = await Promise.all([
      installTree({ ...a.place("a", a.bare), ...shared }),
      installTree({ ...b.place("a", b.bare), ...shared }),
    ]);
    expect(answers).toEqual([INSTALLED, INSTALLED]);
    expect(readdirSync(shared.managers)).toEqual(["pnpm-9.15.0"]);
    expect(existsSync(join(shared.managers, "pnpm-9.15.0", "node_modules/.bin/pnpm"))).toBe(true);
  });

  it("preserves existing pnpm and yarn reached via empty or relative PATH segments (review 0.1.627 B2)", async () => {
    for (const [label, pathOf] of [
      ["trailing empty", (base: string) => `${base}:`],
      ["leading empty", (base: string) => `:${base}`],
      ["relative subdir", (base: string) => `local-bin:${base}`],
    ] as const) {
      const s = setup("pnpm@9.15.0");
      const binDir = label === "relative subdir" ? join(s.root, "local-bin") : s.root;
      mkdirSync(binDir, { recursive: true });
      script(join(binDir, "pnpm"), [`echo "pnpm $*" >> ${JSON.stringify(s.pnpmCalls)}`]);
      const env = { ...s.bare, PATH: pathOf(s.bare.PATH) };
      expect(await installTree(s.place("a", env)), `pnpm (${label})`).toEqual(INSTALLED);
      expect(counted(s.pnpmCalls), `pnpm calls (${label})`).toBe(1);
      expect(counted(s.npmCalls), `npm calls (${label})`).toBe(0);
      expect(existsSync(s.managers), `no cache (${label})`).toBe(false);
    }

    const y = setup("yarn@1.22.22");
    rmSync(join(y.root, "pnpm-lock.yaml"));
    writeFileSync(join(y.root, "yarn.lock"), "# yarn lockfile v1\n");
    const yarnCalls = join(y.dir, "yarn-calls");
    script(join(y.root, "yarn"), [
      `echo "yarn $*" >> ${JSON.stringify(yarnCalls)}`,
      "mkdir -p node_modules/dep",
    ]);
    const yarnEnv = { ...y.bare, PATH: `${y.bare.PATH}:` };
    expect(
      await installTree({
        ...y.place("y", yarnEnv),
        locks: { "yarn.lock": "y" },
      }),
    ).toEqual({ ran: true, command: "yarn install --frozen-lockfile" });
    expect(counted(yarnCalls)).toBe(1);
    expect(counted(y.npmCalls)).toBe(0);
    expect(existsSync(y.managers)).toBe(false);
  });
});

describe("the spec of a missing manager (row 026-22)", () => {
  it.each([
    ["pnpm@12.15.0", "pnpm@12.15.0", "pnpm-12.15.0"],
    ["pnpm@12.15.0+sha512.abc", "pnpm@12.15.0", "pnpm-12.15.0"],
    ["pnpm@11.0.0-rc.1", "pnpm@11.0.0-rc.1", "pnpm-11.0.0-rc.1"],
    ["pnpm@1.2.3-rc-1", "pnpm@1.2.3-rc-1", "pnpm-1.2.3-rc-1"],
    ["pnpm@0.0.0-0.alpha-1", "pnpm@0.0.0-0.alpha-1", "pnpm-0.0.0-0.alpha-1"],
    ["pnpm@01.2.3", "pnpm@latest", "pnpm-latest"],
    ["pnpm@1.02.3", "pnpm@latest", "pnpm-latest"],
    ["pnpm@1.2.3-01", "pnpm@latest", "pnpm-latest"],
    ["pnpm@^9", "pnpm@latest", "pnpm-latest"],
    ["pnpm@9.0.0@evil", "pnpm@latest", "pnpm-latest"],
    ["pnpm@9.0.0 && rm -rf ~", "pnpm@latest", "pnpm-latest"],
    ["pnpm@$(id)", "pnpm@latest", "pnpm-latest"],
    ["pnpm@../../x", "pnpm@latest", "pnpm-latest"],
    ["npm@10.0.0", "pnpm@latest", "pnpm-latest"],
    [undefined, "pnpm@latest", "pnpm-latest"],
  ])("pnpm declared as %s installs %s", (declared, spec, dir) => {
    expect(managerSpec("pnpm", { packageManager: declared }, false)).toEqual({
      name: "pnpm",
      spec,
      dir,
    });
  });

  it("installs Yarn 1 as yarn and later Yarn as @yarnpkg/cli-dist, enforcing strict semver", () => {
    expect(managerSpec("yarn", { packageManager: "yarn@1.22.22" }, false).spec).toBe(
      "yarn@1.22.22",
    );
    expect(managerSpec("yarn", { packageManager: "yarn@4.5.0+sha224.x" }, true)).toEqual({
      name: "yarn",
      spec: "@yarnpkg/cli-dist@4.5.0",
      dir: "yarn-4.5.0",
    });
    expect(managerSpec("yarn", { packageManager: "yarn@4.5.0-rc-1" }, true)).toEqual({
      name: "yarn",
      spec: "@yarnpkg/cli-dist@4.5.0-rc-1",
      dir: "yarn-4.5.0-rc-1",
    });
    expect(managerSpec("yarn", { packageManager: "yarn@01.2.3" }, false).spec).toBe("yarn@latest");
    expect(managerSpec("yarn", { packageManager: "yarn@1.2.3-01" }, true).spec).toBe(
      "@yarnpkg/cli-dist@latest",
    );
    expect(managerSpec("yarn", null, true)).toEqual({
      name: "yarn",
      spec: "@yarnpkg/cli-dist@latest",
      dir: "yarn-berry-latest",
    });
    expect(managerSpec("yarn", null, false).spec).toBe("yarn@latest");
  });
});
