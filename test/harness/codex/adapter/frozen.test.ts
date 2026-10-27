import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../../src/harness/build.js";
import { ADAPTER_HOOKS } from "../../../../src/harness/codex/adapter/index.js";
import { CODEX_HOOKS } from "../../../../src/harness/codex/index.js";
import { observeMetafile } from "../../../helpers/build-inputs.js";

/*
 * Row 002-29 (spec 002 D7): the adapter ships frozen in the fixed plugin, so
 * it may not import a module that changes with the runtime, and it must know
 * every hook entry the runtime serves.
 */

describe("the frozen adapter", () => {
  it("bundles only its own modules and Node builtins", async () => {
    const result = await build({
      entryPoints: ["src/harness/codex/adapter/index.ts"],
      absWorkingDir: REPO_ROOT,
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    observeMetafile(result.metafile);
    const inputs = Object.keys(result.metafile.inputs).sort();
    expect(inputs.filter((path) => !path.startsWith("src/harness/codex/adapter/"))).toEqual([]);
  });

  it("dispatches exactly the runtime's ten hook entries", () => {
    expect([...ADAPTER_HOOKS].sort()).toEqual(Object.keys(CODEX_HOOKS).sort());
  });
});
