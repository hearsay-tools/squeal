import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  LANE_DEFAULTS,
  loadRemoteSettings,
  remoteLaneFor,
  remoteSettingsPath,
  settingsNote,
} from "../../../src/core/runner-host/remote/settings.js";

/*
 * Spec 021 D9 (row 021-13): the remote lane is the user's setting, per
 * repository, off until named, in `$XDG_CONFIG_HOME/squeal/remote.json`.
 * No test reads the real home: every case names its own config directory.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-settings-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
function settings(content: unknown) {
  const xdg = join(scratch, `xdg${++n}`);
  mkdirSync(join(xdg, "squeal"), { recursive: true });
  const env = { XDG_CONFIG_HOME: xdg, HOME: join(scratch, "no-home") };
  if (content !== undefined) {
    writeFileSync(
      remoteSettingsPath(env),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return loadRemoteSettings(env);
}

/** A Git common directory whose config names `urls` as remotes. */
function commonDir(urls: readonly string[]): string {
  const dir = join(scratch, `git${++n}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "config"),
    [
      "[core]",
      "\tbare = false",
      ...urls.flatMap((url, i) => [`[remote "r${i}"]`, `\turl = ${url}`]),
      "",
    ].join("\n"),
  );
  return dir;
}

describe("the remote lane setting (row 021-13)", () => {
  it("is off without the file, and names none", () => {
    const loaded = settings(undefined);
    expect(loaded.repositories).toEqual({});
    expect(loaded.problems).toEqual([]);
    expect(remoteLaneFor(loaded, "/repo", commonDir([]))).toBeNull();
  });

  it("names a lane by the repository's root, with the defaults filled in", () => {
    const root = join(scratch, "repo");
    mkdirSync(root, { recursive: true });
    const loaded = settings({ repositories: { [root]: { target: "build-box" } } });
    expect(remoteLaneFor(loaded, root, commonDir([]))).toEqual({
      key: root,
      lane: {
        ...LANE_DEFAULTS,
        planning: "local",
        coverage: "off",
        target: "build-box",
        providerConfig: { target: "build-box", node: "node", cache: ".squeal-remote" },
      },
    });
    expect(LANE_DEFAULTS.whenLost).toBe("local");
  });

  it("keeps the remote cache outside .cache, which hosts such as boat.dev drop (row 021-25)", () => {
    const loaded = settings({ repositories: { "/r": { target: "box" } } });
    const { cache } = loaded.repositories["/r"] ?? LANE_DEFAULTS;
    expect(cache).toBe(".squeal-remote");
    expect(cache.split("/")[0]).not.toBe(".cache");
  });

  it("names a lane by one of the repository's remote URLs", () => {
    const url = "git@github.com:org/app.git";
    const loaded = settings({
      repositories: {
        [url]: { target: "me@host", whenLost: "not-run", node: "/opt/node/bin/node" },
      },
    });
    const found = remoteLaneFor(loaded, "/elsewhere", commonDir(["https://x/y.git", url]));
    expect(found?.lane).toMatchObject({
      target: "me@host",
      whenLost: "not-run",
      node: "/opt/node/bin/node",
    });
  });

  it("leaves out a bad entry with one problem each, and keeps the good ones", () => {
    const loaded = settings({
      repositories: {
        "/a": { target: "-oProxyCommand=evil" },
        "/b": { target: "box", runner: "mocha" },
        "/c": { target: "box", lanes: ["nightly"] },
        "/d": { target: "box", whenLost: "fail" },
        "/e": { target: "box", colour: "red" },
        "/f": { target: "has space" },
        "/g": { target: "box" },
      },
    });
    expect(Object.keys(loaded.repositories)).toEqual(["/g"]);
    expect(loaded.problems).toHaveLength(6);
    expect(settingsNote(loaded)).toMatch(/remote\.json: "repositories\[\/a\]" "target" must be/);
  });

  it("is the defaults with one problem when the file is not JSON", () => {
    const loaded = settings("{ not json");
    expect(loaded.repositories).toEqual({});
    expect(loaded.problems[0]).toMatch(/not valid JSON/);
  });
});

describe("remote.json under spec 026 D6.4 (row 026-10)", () => {
  it("reads a { target } entry as the ssh provider with 021's defaults", () => {
    const lane = settings({ repositories: { "/r": { target: "box" } } }).repositories["/r"];
    expect(lane).toMatchObject({
      provider: "ssh",
      target: "box",
      runners: ["vitest"],
      lanes: ["background"],
      planning: "local",
      coverage: "off",
      environmentMode: "match-local",
      diskCheck: { enabled: true, maxWriteMs: 10, onSlowDisk: "warn" },
    });
    expect(lane?.idleSleepMinutes).toBeUndefined();
  });

  it("takes the singular runner as an alias, and all lanes and runners by name", () => {
    const loaded = settings({
      repositories: {
        "/a": { target: "box", runner: "pytest" },
        "/b": { target: "box", runners: "all", lanes: "all" },
      },
    });
    expect(loaded.problems).toEqual([]);
    expect(loaded.repositories["/a"]?.runners).toEqual(["pytest"]);
    expect(loaded.repositories["/b"]).toMatchObject({
      runners: ["vitest", "node-test", "pytest", "jest"],
      lanes: ["background", "edit", "slow", "group"],
      // D6.4: an edit tier plans and maps coverage remotely by default.
      planning: "remote",
      coverage: "remote",
    });
  });

  it("keeps explicit planning, coverage, environment mode, idle sleep and disk check", () => {
    const lane = settings({
      repositories: {
        "/r": {
          target: "box",
          lanes: ["edit"],
          planning: "local",
          coverage: "off",
          environmentMode: "remote-key",
          idleSleepMinutes: 0,
          diskCheck: { onSlowDisk: "refuse" },
        },
      },
    }).repositories["/r"];
    expect(lane).toMatchObject({
      planning: "local",
      coverage: "off",
      environmentMode: "remote-key",
      idleSleepMinutes: 0,
      diskCheck: { enabled: true, maxWriteMs: 10, onSlowDisk: "refuse" },
    });
  });

  it("reads deleteUnusedHours, 24 by default and 0 for never; leaves out a bad one (row 026-43)", () => {
    const loaded = settings({
      repositories: {
        "/default": { target: "box" },
        "/short": { target: "box", deleteUnusedHours: 2.5 },
        "/never": { target: "box", deleteUnusedHours: 0 },
        "/negative": { target: "box", deleteUnusedHours: -1 },
        "/text": { target: "box", deleteUnusedHours: "24" },
      },
    });
    const hours = (key: string) => loaded.repositories[key]?.deleteUnusedHours;
    expect([hours("/default"), hours("/short"), hours("/never")]).toEqual([24, 2.5, 0]);
    expect(Object.keys(loaded.repositories)).toEqual(["/default", "/short", "/never"]);
    expect(loaded.problems).toEqual([
      '"repositories[/negative]" "deleteUnusedHours" must be a number of 0 or more (0: never delete); it is left out',
      '"repositories[/text]" "deleteUnusedHours" must be a number of 0 or more (0: never delete); it is left out',
    ]);
  });

  it("defaults onSlowDisk to warn for ssh and command, refuse for agent37, and keeps an explicit one (D11.2)", () => {
    const loaded = settings({
      repositories: {
        "/ssh": { target: "box" },
        "/cmd": { provider: "command", providerConfig: { acquire: ["/bin/lan-up"] } },
        "/a37": { provider: "agent37" },
        "/a37-warn": { provider: "agent37", diskCheck: { onSlowDisk: "warn", maxWriteMs: 20 } },
        "/a37-off": { provider: "agent37", diskCheck: { enabled: false } },
        "/ssh-refuse": { target: "box", diskCheck: { onSlowDisk: "refuse" } },
      },
    });
    expect(loaded.problems).toEqual([]);
    const check = (key: string) => loaded.repositories[key]?.diskCheck;
    expect(check("/ssh")).toEqual({ enabled: true, maxWriteMs: 10, onSlowDisk: "warn" });
    expect(check("/cmd")).toEqual({ enabled: true, maxWriteMs: 10, onSlowDisk: "warn" });
    expect(check("/a37")).toEqual({ enabled: true, maxWriteMs: 10, onSlowDisk: "refuse" });
    expect(check("/a37-warn")).toEqual({ enabled: true, maxWriteMs: 20, onSlowDisk: "warn" });
    expect(check("/a37-off")).toEqual({ enabled: false, maxWriteMs: 10, onSlowDisk: "refuse" });
    expect(check("/ssh-refuse")).toEqual({ enabled: true, maxWriteMs: 10, onSlowDisk: "refuse" });
  });

  it("passes ssh args and a providerConfig target to the ssh provider", () => {
    const lane = settings({
      repositories: { "/r": { providerConfig: { target: "me@host", args: ["-p", "2222"] } } },
    }).repositories["/r"];
    expect(lane?.target).toBe("me@host");
    expect(lane?.providerConfig).toEqual({
      node: "node",
      cache: ".squeal-remote",
      target: "me@host",
      args: ["-p", "2222"],
    });
  });

  it("reads a command entry with its hooks and no target", () => {
    const lane = settings({
      repositories: {
        "/r": {
          provider: "command",
          providerConfig: { acquire: ["/bin/lan-up"], sleep: ["/bin/lan-sleep", "now"] },
          cache: "/srv/cache",
        },
      },
    }).repositories["/r"];
    expect(lane).toMatchObject({ provider: "command", cache: "/srv/cache" });
    expect(lane?.target).toBeUndefined();
    expect(lane?.providerConfig).toMatchObject({ acquire: ["/bin/lan-up"], cache: "/srv/cache" });
  });

  it("leaves out a provider it does not have, a bad hook, and a target on a command lane", () => {
    const loaded = settings({
      repositories: {
        "/a": { provider: "boat" },
        "/b": { provider: "command", providerConfig: { acquire: "lan-up --now" } },
        "/c": { provider: "command", target: "box", providerConfig: { acquire: ["x"] } },
        "/d": { provider: "command", providerConfig: { acquire: ["x"], extra: 1 } },
        "/e": { target: "box", runner: "vitest", runners: ["pytest"] },
        "/f": { target: "box", idleSleepMinutes: -1 },
        "/g": { target: "box", diskCheck: { maxWriteMs: 0 } },
        "/h": { target: "box", providerConfig: { args: "-p 22" } },
        "/i": { target: "box", environmentMode: "darwin" },
      },
    });
    expect(loaded.repositories).toEqual({});
    expect(loaded.problems).toHaveLength(9);
    expect(loaded.problems[0]).toMatch(/"provider" must be one of "ssh", "command", "agent37"/);
    expect(loaded.problems[1]).toMatch(/"acquire" must be a non-empty argument list/);
    expect(loaded.problems[2]).toMatch(/"target" applies to provider "ssh" only/);
  });
});
