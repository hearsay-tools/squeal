import { describe, expect, it } from "vitest";
import type { CommandsThere } from "../../../src/core/runner-host/remote/commands-there.js";
import type { RequiredCommands } from "../../../src/core/types/policy.js";
import type { RunReport } from "../../../src/core/types/runner.js";
import { background, REF, setup, until } from "./lane-fixture.js";

/*
 * Spec 026 D13.2 (row 026-36): per-file `requires.commands` on a lane over a
 * host served in this process. A glob's command the connected remote lacks,
 * or has at another version, keeps that glob's files here, named with the
 * fix; the rest of the tier goes there, and no remote result is stored for
 * the files kept here. A command every test needs still refuses the remote
 * (`lane-needs.test.ts`).
 */

const E2E = { project: "", path: "test/web.e2e.ts" };
const FILES = { "test/web.e2e.ts": "import '../src/a';\n" };
const GLOB = "test/*.e2e.ts";
const paths = (report: RunReport) => report.completedFiles.map((file) => file.path);

describe("per-file requires.commands on a remote lane (row 026-36)", () => {
  it("runs a glob's files here when the remote lacks its command, named, and the rest there", async () => {
    const s = await setup({
      files: FILES,
      requiredCommands: { [GLOB]: ["google-chrome"], "*": ["git"] },
      commandsThere: {
        checked: ["google-chrome", "git"],
        missing: ["google-chrome"],
        versions: [],
      },
    });
    expect(s.commandLines).toEqual([
      `box lacks google-chrome for ${GLOB}; these files run here; add it to remote.setup`,
    ]);
    const report = await s.lane.run([REF, E2E], background());
    // Nothing of the e2e file went there, so no remote result of it can be stored.
    expect(s.remoteRuns).toEqual([REF.path]);
    expect(s.localFiles).toEqual([E2E.path]);
    expect(paths(report)).toEqual([E2E.path, REF.path]);
  });

  it("does the same for a version that differs there", async () => {
    const s = await setup({
      files: FILES,
      requiredCommands: { [GLOB]: [{ command: "google-chrome", version: "--version" }] },
      commandsThere: {
        checked: ["google-chrome"],
        missing: [],
        versions: [
          {
            command: "google-chrome",
            version: "--version",
            here: "Chrome 131",
            there: "Chrome 120",
          },
        ],
      },
    });
    expect(s.commandLines).toEqual([
      `box has google-chrome "Chrome 120", this machine "Chrome 131", for ${GLOB}; these files run here; add it to remote.setup`,
    ]);
    await s.lane.run([REF, E2E], background());
    expect(s.remoteRuns).toEqual([REF.path]);
    expect(s.localFiles).toEqual([E2E.path]);
  });

  it("sends the whole tier there when the remote has every command", async () => {
    const s = await setup({
      files: FILES,
      requiredCommands: { [GLOB]: ["google-chrome"] },
      commandsThere: { checked: ["google-chrome"], missing: [], versions: [] },
    });
    await s.lane.run([REF, E2E], background());
    expect(s.remoteRuns).toEqual([`${REF.path},${E2E.path}`]);
    expect(s.localFiles).toEqual([]);
    expect(s.commandLines).toEqual([]);
  });

  it("routes a tier that waits for the connect by the connect's answer, not before it", async () => {
    for (const lacks of [true, false]) {
      const s = await setup({
        files: FILES,
        eager: false,
        awaitConnect: true,
        requiredCommands: { [GLOB]: ["google-chrome"] },
        commandsThere: {
          checked: ["google-chrome"],
          missing: lacks ? ["google-chrome"] : [],
          versions: [],
        },
      });
      await s.lane.run([REF, E2E], background());
      expect(s.remoteRuns).toEqual(lacks ? [REF.path] : [`${REF.path},${E2E.path}`]);
      expect(s.localFiles).toEqual(lacks ? [E2E.path] : []);
    }
  });

  it("keeps a reloaded glob's files here by the connect's facts (review 0.1.656 B3)", async () => {
    const reloads: readonly [RequiredCommands, RequiredCommands, CommandsThere][] = [
      // The glob moves; the command the connect found missing stays missing.
      [
        { "test/old/**": ["chrome"] },
        { [GLOB]: ["chrome"] },
        { checked: ["chrome"], missing: ["chrome"], versions: [] },
      ],
      // The same glob asks for a version the connect never compared.
      [
        { [GLOB]: ["git"] },
        { [GLOB]: [{ command: "git", version: "--version" }] },
        { checked: ["git"], missing: [], versions: [] },
      ],
      // Another version argument than the one compared.
      [
        { [GLOB]: [{ command: "git", version: "--version" }] },
        { [GLOB]: [{ command: "git", version: "-v" }] },
        {
          checked: ["git"],
          missing: [],
          versions: [{ command: "git", version: "--version", here: "a", there: "a" }],
        },
      ],
    ];
    for (const [before, after, there] of reloads) {
      let policy = before;
      const s = await setup({ files: FILES, requiredCommands: () => policy, commandsThere: there });
      policy = after;
      await s.lane.run([REF, E2E], background());
      // Nothing of the e2e file went there, so no remote result of it can be stored.
      expect(s.remoteRuns).toEqual([REF.path]);
      expect(s.localFiles).toEqual([E2E.path]);
      expect(s.commandLines.at(-1)).toContain(`for ${GLOB}`);
    }
  });

  it("starts a lazy connect from runs whose files all stay here meanwhile (review 0.1.656 B5)", async () => {
    const s = await setup({
      files: FILES,
      eager: false,
      requiredCommands: { [GLOB]: ["google-chrome"] },
      commandsThere: { checked: ["google-chrome"], missing: [], versions: [] },
    });
    // Under `whenLost: "local"` the first run goes here at once; the connect starts.
    await s.lane.run([E2E], background());
    expect(s.localFiles).toEqual([E2E.path]);
    expect(s.connects).toHaveLength(1);
    await until(() => s.lane.report().state === "ready");
    await s.lane.run([E2E], background());
    expect(s.remoteRuns).toEqual([E2E.path]);
    expect(s.connects).toHaveLength(1);
  });

  it("wakes a sleeping lane when a reload names a command its last connect did not look for", async () => {
    let policy: RequiredCommands = { "test/other/**": ["git"] };
    let there: CommandsThere = { checked: ["git"], missing: [], versions: [] };
    const s = await setup({
      files: FILES,
      requiredCommands: () => policy,
      commandsThere: () => there,
    });
    expect(await s.lane.sleep(async () => {})).toBe("slept");
    policy = { [GLOB]: ["google-chrome"] };
    there = { checked: ["google-chrome"], missing: [], versions: [] };
    await s.lane.run([E2E], background());
    expect(s.localFiles).toEqual([E2E.path]);
    expect(s.connects).toHaveLength(2);
    await until(() => s.lane.report().state === "ready");
    await s.lane.run([E2E], background());
    expect(s.remoteRuns).toEqual([E2E.path]);
  });
});
