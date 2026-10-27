import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCommand } from "../../src/cli/start.js";
import * as daemon from "../../src/core/daemon/ensure.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { codexDataOf, writeFixedPlugin } from "../cli/codex-runtime-fixture.js";
import { tempDir } from "../store/helpers.js";
import { createFixtureRepo } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("002-36: start cannot retain a seed runtime", () => {
  it.each(["unwritable data", "changed seed bytes"])(
    "fails with an action for %s",
    async (fault) => {
      const repo = createFixtureRepo();
      const codex = tempDir("squeal-start-seed-");
      const adapter = join(codex, "plugins/cache/hearsay/squeal/1.0.0");
      writeFixedPlugin(adapter, "1.0.0", squealVersion(), "#!/bin/sh\n");
      if (fault === "unwritable data") {
        const data = codexDataOf(codex);
        mkdirSync(dirname(data), { recursive: true });
        writeFileSync(data, "not a directory\n");
      } else {
        writeFileSync(join(adapter, "seed/skills/squeal/SKILL.md"), "changed since manifest\n");
      }
      const ensure = vi.spyOn(daemon, "ensureDaemonProcess");
      const argv = process.argv;
      process.argv = [process.execPath, join(adapter, "seed/dist/cli/squeal.mjs")];
      let stderr = "";
      try {
        const code = await startCommand([], {
          cwd: repo.root,
          env: { CODEX_HOME: codex },
          stdout: () => {},
          stderr: (text) => {
            stderr += text;
          },
        });
        expect(code).toBe(1);
        expect(stderr).toContain("could not retain the seed runtime before starting a daemon");
        expect(stderr).toContain("retry squeal start");
        expect(ensure).not.toHaveBeenCalled();
      } finally {
        process.argv = argv;
        repo.cleanup();
      }
    },
  );
});
