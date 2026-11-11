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
      lane: { ...LANE_DEFAULTS, target: "build-box" },
    });
    expect(LANE_DEFAULTS.whenLost).toBe("local");
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
        "/b": { target: "box", runner: "pytest" },
        "/c": { target: "box", lanes: ["edit"] },
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
