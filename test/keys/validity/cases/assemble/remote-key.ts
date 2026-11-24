import type { CoreEnvironmentInputs } from "../../../../../src/core/types/keys.js";
import type { Case } from "../../case.js";

/*
 * Spec 026 D10 (row 026-14): under `environmentMode: "remote-key"` the
 * runner's environment names the remote's core, and the project is keyed
 * under its Node, platform and arch; `keyForCore` gives a file's key on
 * another machine, so a run there is stored only under that machine's key.
 * A tree before 026-14 keys under its own machine and gives no other key,
 * so the keys differ and ask no raise: no stored meaning changes.
 */

const TEST = "test/a.test.ts";

const LINUX: CoreEnvironmentInputs = {
  squealVersion: "0.0.0-validity",
  nodeVersion: "v26.13.0",
  platform: "linux",
  arch: "x64",
  installedDependencies: "none",
  env: {},
};

export const REMOTE_KEY: readonly Case[] = [
  {
    kind: "assemble",
    name: "a project keyed under a remote's machine, and a file's key on other machines",
    why: "026 D10.2: the key holds the remote's Node, platform and arch; a darwin key and a linux key of one file differ, and the keyed machine's is the file's key",
    input: {
      files: {
        "src/app.ts": "export const app = 1;\n",
        "vitest.config.ts": "export default {};\n",
        [TEST]: "import '../src/app';\n",
      },
      environment: {
        project: "",
        runnerName: "validity",
        runnerVersion: "1",
        adapterVersion: "1",
        resolvedConfig: "{}",
        files: ["vitest.config.ts"],
        core: LINUX,
      },
      closures: [{ path: TEST, imports: ["src/app.ts"] }],
      otherMachines: [
        { ...LINUX, platform: "darwin", arch: "arm64" },
        { ...LINUX, nodeVersion: "v24.22.1" },
        LINUX,
      ],
    },
  },
];
