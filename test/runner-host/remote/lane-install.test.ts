import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { background, ENV, REF, setup, until } from "./lane-fixture.js";
import {
  counted,
  countedPnpm,
  earlierRecord,
  PNPM,
  pnpmInstall,
  restoreMoved,
  writePnpmProject,
} from "./pnpm-project.js";

/*
 * Row 021-24 (`boat-trial.md` D3): a remote restored onto a new machine
 * keeps its install, but the folders' file times moved, so npm's and
 * pnpm's own records no longer stand for them and the key reads another
 * install: "installed dependencies differ". The host installs again once
 * and the run goes on; a difference an install cannot mend stands, with no
 * second install. The lane compares at connect and names a refusal there.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-lane-install-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
/**
 * A fake `npm` that installs one package, `dep` at `$DEP_VERSION` (default
 * 1.0.0), the way `npm ci` leaves it: the hidden lockfile written after the
 * folder. Each install adds a line to `count`.
 */
function fakeNpm(count: string, version?: string): NodeJS.ProcessEnv {
  const bin = join(scratch, `bin${++n}`);
  mkdirSync(bin, { recursive: true });
  const lock = (v: string) =>
    JSON.stringify({
      name: "app",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "app" }, "node_modules/dep": { version: v } },
    });
  writeFileSync(
    join(bin, "npm"),
    [
      "#!/bin/sh",
      `echo "npm $*" >> ${JSON.stringify(count)}`,
      'v="$DEP_VERSION"; [ -n "$v" ] || v=1.0.0',
      "mkdir -p node_modules/dep",
      `printf '{"name":"dep","version":"%s"}' "$v" > node_modules/dep/package.json`,
      `printf '%s' '${lock("1.0.0")}' | sed "s/1\\.0\\.0/$v/" > node_modules/.package-lock.json`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "npm"), 0o755);
  return {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    ...(version === undefined ? {} : { DEP_VERSION: version }),
  };
}

/** Installs here with the fake `npm`, `dep` at `version`. */
function installHere(root: string, version = "1.0.0") {
  execFileSync("npm", ["ci"], { cwd: root, env: fakeNpm(join(scratch, `here${++n}`), version) });
}

const lines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n") : [""]);
const installs = (path: string) => lines(path).filter((line) => line !== "").length;

/** As a restore onto a new machine leaves it: the installed folder newer than npm's record. */
function restored(remoteRoot: string) {
  const later = new Date(Date.now() + 86_400_000);
  utimesSync(join(remoteRoot, "node_modules/dep"), later, later);
}

const PROJECT = {
  ".gitignore": "node_modules\n",
  "package.json": '{"name":"app"}\n',
  "package-lock.json": '{"lockfileVersion":3}\n',
};

describe("a remote restored onto a new machine (row 021-24)", () => {
  it("installs again once when its folders' times moved, and the run is proven", async () => {
    const count = join(scratch, `remote${++n}`);
    const s = await setup({
      installEnv: fakeNpm(count),
      files: PROJECT,
      before: (root) => installHere(root),
    });
    expect(installs(count)).toBe(1);
    expect((await s.lane.run([REF], background())).end).toBe("completed");
    expect(s.remoteRuns).toHaveLength(1);

    restored(s.remoteRoot);
    await s.lane.invalidate([{ path: "src/a.ts", kind: "change" }]);
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("completed");
    expect(s.remoteRuns).toHaveLength(2);
    expect(s.localRuns).toHaveLength(0);
    expect(installs(count)).toBe(2);
    expect(s.logs).toContain(
      "remote box: installed dependencies differ; installed again with npm ci",
    );
    expect(s.logs.at(-1)).toMatch(/^remote box: run proven over \d+ paths$/);
    // Made again from scratch: the folder's time is the new install's.
    expect(statSync(join(s.remoteRoot, "node_modules/dep")).mtimeMs).toBeLessThan(Date.now());
  });

  it("installs again at connect when a restore moved the folders' times since the last connect", async () => {
    const count = join(scratch, `remote${++n}`);
    const s = await setup({
      installEnv: fakeNpm(count),
      files: PROJECT,
      before: (root) => installHere(root),
    });
    // Refused for another reason, so the lane is down while the remote is restored.
    s.remote.env = { ...ENV, runnerVersion: "5.0.2" };
    await s.lane.run([REF], background());
    expect(installs(count)).toBe(1);
    restored(s.remoteRoot);
    s.remote.env = ENV;
    s.advance(60_000);
    await s.lane.run([REF], background());
    await until(() => s.statuses.at(-1)?.endsWith("environment equal)") === true);
    expect(installs(count)).toBe(2);
    expect(s.logs.some((line) => line.includes("installed again"))).toBe(false);
    expect((await s.lane.run([REF], background())).end).toBe("completed");
    expect(s.remoteRuns).toHaveLength(1);
    expect(s.statuses.at(-1)).toMatch(/^remote box: background runs of vitest go there; proven at/);
  });

  it("lets a refusal the install did not mend stand, with its text, and installs no more", async () => {
    const count = join(scratch, `remote${++n}`);
    const s = await setup({
      installEnv: fakeNpm(count),
      files: PROJECT,
      before: (root) => installHere(root),
    });
    // The install here changed, and the remote's folders moved.
    installHere(s.root, "2.0.0");
    restored(s.remoteRoot);
    await s.lane.run([REF], background());
    expect(installs(count)).toBe(2);
    expect(s.remoteRuns).toEqual([]);
    expect(s.localRuns).toHaveLength(1);
    expect(s.statuses.at(-1)).toBe(
      "remote box refused: installed dependencies differ; running here",
    );
    // Reconnected after the backoff: refused again at connect, with no install.
    s.advance(60_000);
    await s.lane.run([REF], background());
    await s.lane.run([REF], background());
    expect(s.connects).toHaveLength(2);
    expect(installs(count)).toBe(2);
    expect(s.remoteRuns).toEqual([]);
    expect(s.statuses.at(-1)).toBe(
      "remote box refused: installed dependencies differ; running here",
    );
  });

  it("says connected, not yet compared, then names a refusal before any run", async () => {
    const s = await setup({ remoteEnv: { ...ENV, runnerVersion: "5.0.2" } });
    expect(s.statuses).toEqual([
      "remote box: connected (Node v-test), not yet compared",
      expect.stringMatching(
        /^remote box refused: .*5\.0\.2 on the remote, 5\.0\.3 here; running here$/,
      ),
    ]);
    expect(s.remoteRuns).toEqual([]);
    expect(s.localRuns).toEqual([]);
  });

  it("says go there only once the environment is compared equal", async () => {
    const s = await setup();
    expect(s.statuses).toEqual([
      "remote box: connected (Node v-test), not yet compared",
      "remote box: background runs of vitest go there (Node v-test; environment equal)",
    ]);
  });
});

describe.skipIf(PNPM === null)(
  "a restored remote whose install record an earlier release wrote, with real pnpm (review 0.1.454 B1)",
  // Each test runs real pnpm installs; the 5 s default fails on a loaded host.
  { timeout: 60_000 },
  () => {
    it("installs from scratch once at the next connect, runs proven, and installs no more", async () => {
      const dir = join(scratch, `pnpm${++n}`);
      const count = join(dir, "installs");
      const s = await setup({
        installEnv: countedPnpm(join(dir, "bin"), count),
        files: { ".gitignore": "node_modules\n" },
        before: (root) => {
          writePnpmProject(root, join(dir, "pnpm"));
          pnpmInstall(root);
        },
      });
      expect(counted(count)).toBe(1);
      expect(s.statuses.at(-1)).toMatch(/go there \(Node v-test; environment equal\)$/);
      /** Down for a reason of its own, then back at the next connect. */
      const reconnect = async (meanwhile: () => void) => {
        s.remote.env = { ...ENV, runnerVersion: "5.0.2" };
        await s.lane.run([REF], background());
        expect(s.statuses.at(-1)).toMatch(/^remote box refused: .*5\.0\.2 on the remote/);
        meanwhile();
        s.remote.env = ENV;
        s.advance(60_000);
        const from = s.statuses.length;
        await s.lane.run([REF], background());
        await until(() => s.statuses.slice(from).some((t) => / go there \(| refused/.test(t)));
      };
      // An earlier release's cache, kept across a restore onto a new machine.
      await reconnect(() => {
        earlierRecord(join(s.remoteRoot, "../installed.json"));
        restoreMoved(s.remoteRoot);
      });
      expect(s.statuses.at(-1)).toMatch(/go there \(Node v-test; environment equal\)$/);
      expect(counted(count)).toBe(2);
      expect((await s.lane.run([REF], background())).end).toBe("completed");
      expect(s.remoteRuns).toHaveLength(1);
      expect(s.statuses.at(-1)).toMatch(
        /^remote box: background runs of vitest go there; proven at/,
      );
      // Later connects find the record the migration wrote: no install.
      await reconnect(() => {});
      await reconnect(() => {});
      expect(counted(count)).toBe(2);
      expect((await s.lane.run([REF], background())).end).toBe("completed");
      expect(s.remoteRuns).toHaveLength(2);
    });
  },
);
