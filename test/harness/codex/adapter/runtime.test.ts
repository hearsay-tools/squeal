import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleOptions, nodeFloor } from "../../../../src/harness/build.js";
import { pinFile } from "../../../../src/harness/codex/adapter/layout.js";
import { CODEX_PLUGIN } from "../../../../src/harness/codex/build.js";
import type { CodexHookName } from "../../../../src/harness/codex/index.js";
import { observeMetafile } from "../../../helpers/build-inputs.js";
import { liveSocket, runBundle, runtimeDir } from "../../bundle-helpers.js";
import { squealRepo } from "../../helpers.js";
import { codexPluginAt } from "../cache-fixture.js";
import { codexRecorded, sessionOf } from "../helpers.js";
import { ADAPTER_VERSION, buildAdapter, runAdapter, write, writeManifest } from "./fixture.js";

/*
 * Row 002-29 (spec 002 D9, `wave-4-contract.md`): a real runtime, the Codex
 * plugin's bundles plus `dist/runtime.mjs` from `runtime-entry.ts`, run
 * in-process by the fixed plugin's adapter, prints what its own hook bundle
 * prints for the same input in the same state.
 */

const VERSION = "0.1.950";
const SESSION = sessionOf("exec", "session-start");
const SLOW = { timeout: 120_000 } as const;

let scratch = "";
let adapter = "";
let runtime = "";
beforeAll(async () => {
  scratch = mkdtempSync("/tmp/sq-adapter-rt-");
  adapter = await buildAdapter(scratch);
  runtime = join(scratch, "runtime");
  await codexPluginAt(runtime, VERSION);
  const options = bundleOptions(CODEX_PLUGIN, join(runtime, "dist"));
  const result = await build({
    ...options,
    entryPoints: [{ in: "src/harness/codex/runtime-entry.ts", out: "runtime" }],
    define: { ...options.define, __SQUEAL_VERSION__: JSON.stringify(VERSION) },
  });
  observeMetafile(result.metafile);
  writeManifest(runtime, VERSION, nodeFloor());
}, 180_000);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** One machine: a fixed plugin seeded with the real runtime, a data dir and a repository. */
async function machine() {
  const dir = mkdtempSync(join(scratch, "m-"));
  const plugin = join(dir, "plugin");
  write(
    join(plugin, ".codex-plugin", "plugin.json"),
    `${JSON.stringify({ name: "squeal", version: ADAPTER_VERSION })}\n`,
  );
  cpSync(runtime, join(plugin, "seed"), { recursive: true });
  const data = join(dir, "data");
  const r = squealRepo();
  r.apply(r.pass());
  const run = runtimeDir();
  await liveSocket(join(run, `squeal-${r.worktreeId}.sock`));
  const env = { XDG_RUNTIME_DIR: run, PLUGIN_DATA: data, HOME: dir, PATH: process.env.PATH ?? "" };
  return { plugin, data, r, env, retained: join(data, "versions", VERSION) };
}

const EVENTS: readonly [CodexHookName, string][] = [
  ["session-start", "session-start"],
  ["user-prompt-submit", "user-prompt-submit"],
  ["pre-tool-use", "pre-tool-use-apply-patch"],
  ["post-tool-use", "post-tool-use"],
  ["stop", "stop"],
  ["session-end", "session-end"],
];

describe("a real runtime through the adapter (002-29)", () => {
  it(
    "prints what its own hook bundles print, event by event, through a regression",
    SLOW,
    async () => {
      const direct = await machine();
      const adapted = await machine();
      // The adapter publishes the seed at first contact; the direct runs use that same tree.
      const seeded = await runAdapter(
        adapter,
        "interrupt",
        codexRecorded("exec", "user-prompt-submit", adapted.r.root, { session_id: "warm" }),
        { ...adapted.env, PLUGIN_ROOT: adapted.plugin },
      );
      expect(seeded).toMatchObject({ code: 0, stderr: "" });
      cpSync(adapted.retained, direct.retained, { recursive: true });
      const same = (text: string, m: Awaited<ReturnType<typeof machine>>) =>
        text.replaceAll(m.data, "<data>").replaceAll(m.r.root, "<repo>");
      for (const [name, fixture] of EVENTS) {
        if (name === "post-tool-use") {
          direct.r.apply(direct.r.fail());
          adapted.r.apply(adapted.r.fail());
        }
        const by = (m: typeof direct) => codexRecorded("exec", fixture, m.r.root, SESSION);
        const want = await runBundle(
          name,
          by(direct),
          { ...direct.env, PLUGIN_ROOT: direct.retained },
          join(direct.retained, "dist"),
        );
        const got = await runAdapter(adapter, name, by(adapted), {
          ...adapted.env,
          PLUGIN_ROOT: adapted.plugin,
        });
        expect(got.code, name).toBe(0);
        expect(same(got.stderr, adapted), name).toBe(same(want.stderr, direct));
        expect(same(got.stdout, adapted), name).toBe(same(want.stdout, direct));
        // The runtime's own identity: the skill it retained, the regression it delivers.
        if (name === "session-start") expect(got.stdout).toContain(`versions/${VERSION}/skills/`);
        if (name === "post-tool-use") expect(got.stdout).toContain("PASS -> FAIL");
      }
      // SessionEnd released the pin after dispatch.
      expect(
        existsSync(pinFile(adapted.data, String((SESSION as { session_id: string }).session_id))),
      ).toBe(false);
    },
  );
});
