import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flag } from "../../src/core/ps/flags.js";
import { writeCurrent, writeFixedPlugin, writeRuntime } from "../cli/codex-runtime-fixture.js";
import {
  consumer,
  foundDaemon,
  installScript,
  type ModelHost,
  makeRoot,
  modelHost,
  modelOf,
  workOf,
} from "./fixture-model.js";

let host: ModelHost;
beforeEach(() => {
  host = modelHost();
});
afterEach(() => {
  rmSync(host.base, { recursive: true, force: true });
});

describe("002-36: ps compares a Codex daemon with the installed runtime", () => {
  it("does not call a seed daemon older than its fixed adapter", () => {
    const adapter = join(host.places.home, ".codex/plugins/cache/hearsay/squeal/1.0.0");
    writeFixedPlugin(adapter, "1.0.0", "0.1.5", "#!/bin/sh\n");
    const script = installScript(host.places.home, "codex", "0.1.5");
    const daemon = foundDaemon({ pid: 4100, root: makeRoot(host, "repo").root, script });
    const run = (held = false) => {
      const first = workOf(daemon, {
        consumers: held ? [consumer({ version: "0.1.5" })] : [],
      });
      return flag(modelOf({ host, daemons: [{ daemon, first }] }));
    };
    expect(run().daemons.get(4100) ?? []).toEqual([]);
    expect(run().states.has(4100)).toBe(false);
    const data = join(host.places.home, ".codex/plugins/data/squeal-hearsay");
    writeRuntime(join(data, "versions", "0.1.6"), "0.1.6", "#!/bin/sh\n");
    writeCurrent(data, "0.1.6");
    expect(run().daemons.get(4100)).toEqual([
      {
        flag: "older",
        reason: "version 0.1.5; codex installs 0.1.6",
        command: `squeal stop ${daemon.root}`,
      },
    ]);
    expect(run(true).states.get(4100)).toBe("older (session 3212240 holds it)");
  });
});
