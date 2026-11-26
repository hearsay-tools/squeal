import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbsolutePath } from "../../../src/core/types/common.js";

// Spec 027 D4: reading consent never starts docker, nor any other process.
const spawned = vi.hoisted(() => [] as string[]);
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const record =
    <F extends (...args: never[]) => unknown>(name: string, fn: F) =>
    (...args: Parameters<F>) => {
      spawned.push(`${name} ${String(args[0])}`);
      return fn(...args);
    };
  return {
    ...actual,
    spawn: record("spawn", actual.spawn),
    spawnSync: record("spawnSync", actual.spawnSync),
    execFile: record("execFile", actual.execFile),
    execFileSync: record("execFileSync", actual.execFileSync),
    exec: record("exec", actual.exec),
    execSync: record("execSync", actual.execSync),
  };
});

const {
  CONTAINERS_FILE,
  consentSettingsNote,
  containerConsentFor,
  containerConsentPath,
  isTargetConsented,
  loadContainerConsent,
  resolveContainerNetwork,
  unconsentedNote,
} = await import("../../../src/core/runner-host/container/consent.js");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): AbsolutePath {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-consent-"))) as AbsolutePath;
  dirs.push(dir);
  return dir;
}

/** A user config home holding `containers.json` with `contents`, or none. */
function userHome(contents: unknown): NodeJS.ProcessEnv {
  const home = tempDir();
  if (contents !== undefined) {
    mkdirSync(join(home, "squeal"));
    writeFileSync(join(home, "squeal", CONTAINERS_FILE), JSON.stringify(contents));
  }
  return { XDG_CONFIG_HOME: home };
}

/** A repository root and a common directory whose config names `url` as origin. */
function repository(url?: string): { root: AbsolutePath; commonDir: AbsolutePath } {
  const root = tempDir();
  const commonDir = join(root, ".git") as AbsolutePath;
  mkdirSync(commonDir);
  const remote = url === undefined ? "" : `[remote "origin"]\n\turl = ${url}\n`;
  writeFileSync(join(commonDir, "config"), `[core]\n\tbare = false\n${remote}`);
  return { root, commonDir };
}

describe("containers.json (spec 027 D4)", () => {
  it("sits beside the user config and allows nothing when absent", () => {
    const env = userHome(undefined);
    const settings = loadContainerConsent(env);
    expect(settings.path).toBe(join(env.XDG_CONFIG_HOME as string, "squeal", "containers.json"));
    expect(containerConsentPath(env)).toBe(settings.path);
    expect(settings).toMatchObject({ allow: {}, problems: [] });
    expect(consentSettingsNote(settings)).toBeNull();
    const { root, commonDir } = repository();
    expect(containerConsentFor(settings, root, commonDir)).toBeNull();
    expect(spawned).toEqual([]);
  });

  it("matches a repository by its real root path first", () => {
    const { root, commonDir } = repository("git@github.com:org/app.git");
    const link = join(tempDir(), "link");
    symlinkSync(root, link);
    const settings = loadContainerConsent(
      userHome({
        allow: {
          [link]: { enabled: true, targets: ["backend"] },
          "git@github.com:org/app.git": { enabled: true, targets: "all" },
        },
      }),
    );
    expect(containerConsentFor(settings, root, commonDir)).toEqual({
      key: root,
      consent: { enabled: true, targets: ["backend"] },
    });
  });

  it("matches a repository by a remote URL when its root has no entry", () => {
    const { root, commonDir } = repository("https://github.com/org/app.git");
    const settings = loadContainerConsent(
      userHome({
        allow: {
          "https://github.com/org/app.git": {
            enabled: true,
            targets: "all",
            composeProject: "sb-dev",
          },
        },
      }),
    );
    expect(containerConsentFor(settings, root, commonDir)).toEqual({
      key: "https://github.com/org/app.git",
      consent: { enabled: true, targets: "all", composeProject: "sb-dev" },
    });
    expect(containerConsentFor(settings, root, repository().commonDir)).toBeNull();
  });

  it.each([
    ["not an object", true, "must be an object"],
    [
      "an unknown key",
      { enabled: true, targets: "all", privileged: true },
      'unknown key "privileged"',
    ],
    ["no enabled", { targets: "all" }, '"enabled" must be true or false'],
    ["no targets", { enabled: true }, '"targets" must be'],
    ["empty targets", { enabled: true, targets: [] }, '"targets" must be'],
    ["a bad target name", { enabled: true, targets: ["a b"] }, '"targets" must be'],
    [
      "a bad compose project",
      { enabled: true, targets: "all", composeProject: "-p" },
      '"composeProject"',
    ],
    [
      "a bad network",
      { enabled: true, targets: "all", networkOverride: "a b" },
      '"networkOverride"',
    ],
  ])("leaves out an entry with %s and keeps the others", (_, entry, why) => {
    const settings = loadContainerConsent(
      userHome({
        allow: { "git@x:bad.git": entry, "git@x:good.git": { enabled: false, targets: "all" } },
      }),
    );
    expect(Object.keys(settings.allow)).toEqual(["git@x:good.git"]);
    expect(settings.problems).toEqual([expect.stringContaining(why)]);
    expect(settings.problems[0]).toMatch(/^"allow\[git@x:bad\.git\]" .*; it is left out$/);
    expect(consentSettingsNote(settings)).toContain(settings.path);
  });

  it("is no consent with one problem when allow is not an object", () => {
    const settings = loadContainerConsent(userHome({ allow: [] }));
    expect(settings.allow).toEqual({});
    expect(settings.problems).toHaveLength(1);
  });
});

describe("isTargetConsented", () => {
  it("allows only listed targets of an enabled entry", () => {
    const consent = { enabled: true, targets: ["backend"] };
    expect(isTargetConsented(consent, "backend")).toBe(true);
    expect(isTargetConsented(consent, "workers")).toBe(false);
    expect(isTargetConsented({ enabled: true, targets: "all" }, "workers")).toBe(true);
  });

  it("allows nothing when the entry is missing or disabled", () => {
    expect(isTargetConsented(null, "backend")).toBe(false);
    expect(isTargetConsented(undefined, "backend")).toBe(false);
    expect(isTargetConsented({ enabled: false, targets: "all" }, "backend")).toBe(false);
  });
});

describe("resolveContainerNetwork", () => {
  it("keeps the declared network, or Docker's default when none", () => {
    expect(resolveContainerNetwork({ network: "app_default" }, null)).toEqual({
      network: "app_default",
    });
    expect(resolveContainerNetwork({}, { composeProject: "sb" })).toEqual({});
  });

  it("puts networkOverride over the declared network", () => {
    const consent = { networkOverride: "sb-dev_default" };
    expect(resolveContainerNetwork({ network: "app_default" }, consent)).toEqual({
      network: "sb-dev_default",
    });
    expect(resolveContainerNetwork({}, consent)).toEqual({ network: "sb-dev_default" });
  });

  it("fills {composeProject} from the consent", () => {
    const target = { network: "{composeProject}_default" };
    expect(resolveContainerNetwork(target, { composeProject: "sb-dev" })).toEqual({
      network: "sb-dev_default",
    });
    expect(
      resolveContainerNetwork(target, {
        composeProject: "a",
        networkOverride: "{composeProject}_x",
      }),
    ).toEqual({ network: "a_x" });
  });

  it("refuses {composeProject} when the consent sets none", () => {
    const target = { network: "{composeProject}_default" };
    for (const consent of [null, {}]) {
      const resolved = resolveContainerNetwork(target, consent);
      expect(resolved).toEqual({ problem: expect.stringContaining('needs "composeProject"') });
    }
  });
});

describe("unconsentedNote", () => {
  it("names the project, the target, setup, the file and the root-equivalent risk", () => {
    const note = unconsentedNote("backend", "web", "/u/.config/squeal/containers.json");
    expect(note).toContain('project "backend" runs in container target "web"');
    expect(note).toContain("its files stay unknown");
    expect(note).toContain("`squeal setup`");
    expect(note).toContain("/u/.config/squeal/containers.json");
    expect(note).toContain("root-equivalent");
  });

  it("follows a missing or disabled consent without starting any process", () => {
    const { root, commonDir } = repository("git@x:app.git");
    for (const contents of [
      undefined,
      { allow: { "git@x:app.git": { enabled: false, targets: "all" } } },
    ]) {
      const settings = loadContainerConsent(userHome(contents));
      const found = containerConsentFor(settings, root, commonDir);
      expect(isTargetConsented(found?.consent, "backend")).toBe(false);
      expect(unconsentedNote("backend", "backend", settings.path)).toContain(settings.path);
    }
    expect(spawned).toEqual([]);
  });
});
