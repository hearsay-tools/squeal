import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discover } from "../../src/core/ps/discover.js";
import { flag } from "../../src/core/ps/flags.js";
import type { FoundDaemon } from "../../src/core/ps/model.js";
import { createProcSource } from "../../src/core/ps/proc.js";
import {
  consumer,
  foundDaemon,
  type ModelHost,
  makeRoot,
  modelHost,
  modelOf,
  workOf,
  writeAged,
} from "./fixture-model.js";
import {
  daemonProcess,
  type FixtureHost,
  HOME,
  makeHost,
  makeRepo,
  writeProcesses,
} from "./fixture-stores.js";

/*
 * Spec 024 D5 (row 024-05): `squeal ps` finds the daemons Antigravity's hooks
 * start, from the installed plugin or from a retained copy in its plugin
 * data directory, compares a copy's version with the installed plugin's for
 * `older`, and calls neither `not-installed`.
 */

const INSTALLED = ".gemini/config/plugins/squeal";
const COPY = (version: string) => `.gemini/antigravity-cli/plugin_data/squeal/versions/${version}`;

describe("discovery", () => {
  let host: FixtureHost;
  beforeEach(() => {
    host = makeHost();
  });
  afterEach(() => {
    rmSync(host.base, { recursive: true, force: true });
  });

  it("names Antigravity as the harness of both, with the copy's version from its path", () => {
    const repo = makeRepo(host.base, "alpha");
    writeProcesses(host, [
      daemonProcess({
        pid: 500,
        root: repo.root,
        script: `${HOME}/${INSTALLED}/dist/cli/squeal.mjs`,
      }),
      daemonProcess({
        pid: 501,
        root: repo.root,
        script: `${HOME}/${COPY("0.1.601")}/dist/cli/squeal.mjs`,
      }),
      // Another plugin's directory is not Squeal's.
      daemonProcess({
        pid: 502,
        root: repo.root,
        script: `${HOME}/.gemini/config/plugins/other/dist/cli/squeal.mjs`,
      }),
    ]);
    const source = createProcSource({ root: host.base, run: () => null });
    const by = new Map(
      discover(source, source.processTable(), host.places).daemons.map((d) => [
        d.row.pid,
        [d.harness, d.version],
      ]),
    );
    expect(by.get(500)).toEqual(["antigravity", null]);
    expect(by.get(501)).toEqual(["antigravity", "0.1.601"]);
    expect(by.get(502)).toEqual([null, null]);
  });
});

describe("flags", () => {
  let host: ModelHost;
  beforeEach(() => {
    host = modelHost();
  });
  afterEach(() => {
    rmSync(host.base, { recursive: true, force: true });
  });

  /** An Antigravity daemon at `dir` under the model's home, its bundle written, as `discover` finds it. */
  function agyDaemon(pid: number, dir: string, version: string | null, root: string): FoundDaemon {
    const script = writeAged(join(host.places.home, dir, "dist", "cli", "squeal.mjs"));
    return { ...foundDaemon({ pid, root, script }), harness: "antigravity", version };
  }

  function installed(version: string): void {
    const plugin = join(host.places.home, INSTALLED);
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ version }));
  }

  it("flags a retained copy older than the installed plugin, and holds it while its session lives", () => {
    installed("0.1.602");
    const daemon = agyDaemon(4300, COPY("0.1.601"), "0.1.601", makeRoot(host, "repo").root);
    const run = (held: boolean) =>
      flag(
        modelOf({
          host,
          daemons: [
            {
              daemon,
              first: workOf(daemon, { consumers: held ? [consumer({ version: "0.1.601" })] : [] }),
            },
          ],
        }),
      );
    expect(run(false).daemons.get(4300)).toEqual([
      {
        flag: "older",
        reason: "version 0.1.601; antigravity installs 0.1.602",
        command: `squeal stop ${daemon.root}`,
      },
    ]);
    expect(run(true).states.get(4300)).toBe("older (session 3212240 holds it)");
  });

  it("leaves a copy of the installed version, and the installed plugin's own daemon, alone", () => {
    installed("0.1.602");
    const root = makeRoot(host, "repo").root;
    const copy = agyDaemon(4301, COPY("0.1.602"), "0.1.602", root);
    const own = agyDaemon(4302, INSTALLED, null, makeRoot(host, "other").root);
    const out = flag(
      modelOf({
        host,
        daemons: [
          { daemon: copy, first: workOf(copy) },
          { daemon: own, first: workOf(own) },
        ],
      }),
    );
    expect(out.daemons.get(4301) ?? []).toEqual([]);
    expect(out.daemons.get(4302) ?? []).toEqual([]);
  });

  it("names the rule unknown when no installed version can be read", () => {
    const daemon = agyDaemon(4303, COPY("0.1.601"), "0.1.601", makeRoot(host, "repo").root);
    const out = flag(modelOf({ host, daemons: [{ daemon, first: workOf(daemon) }] }));
    expect(out.daemons.get(4303) ?? []).toEqual([]);
    expect(out.unknown).toContainEqual({
      what: "daemon 4303 flag older",
      why: `no installed antigravity version can be read under ${join(host.places.home, INSTALLED)}`,
    });
  });

  it("never calls a daemon of either place not-installed, though its root is under the temp directory", () => {
    const root = join(host.places.tempDir, "squeal-agy-repo");
    mkdirSync(join(root, ".git"), { recursive: true });
    const own = {
      ...agyDaemon(4304, INSTALLED, null, root),
      row: { ...foundDaemon({ pid: 4304, root, ageS: 7200 }).row },
    };
    const copy = {
      ...agyDaemon(4305, COPY("0.1.601"), "0.1.601", root),
      row: { ...foundDaemon({ pid: 4305, root, ageS: 7200 }).row },
    };
    const out = flag(
      modelOf({
        host,
        daemons: [
          { daemon: own, first: workOf(own) },
          { daemon: copy, first: workOf(copy) },
        ],
      }),
    );
    for (const pid of [4304, 4305]) {
      expect((out.daemons.get(pid) ?? []).map((f) => f.flag)).not.toContain("not-installed");
    }
  });
});
