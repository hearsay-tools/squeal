import type { Case } from "../../case.js";

/*
 * Spec 018 D1 (row 018-06): the daemon records each environment hash with
 * its parts where it computes the hash, from the same inputs. The record
 * enters no key, so the keys are equal at both trees; this case runs the
 * per-field hashing of a resolved config that has fields, which the `{}`
 * configs of the other cases do not reach.
 */

const TEST = "test/a.test.ts";

const FILES = {
  "src/app.ts": "export const app = 1;\n",
  "vitest.config.ts": "export default {};\n",
  [TEST]: "import '../src/app';\n",
};

const environment = (resolvedConfig: string) => ({
  project: "",
  runnerName: "validity",
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig,
  files: ["vitest.config.ts"],
});

const closures = [{ path: TEST, imports: ["src/app.ts"] }];

export const DESCRIBED: readonly Case[] = [
  {
    kind: "assemble",
    name: "an environment whose resolved config has fields, recorded with its parts",
    why: "018 D1: the environment record hashes each top-level config field beside the hash and changes no key, at both trees alike",
    input: {
      files: FILES,
      environment: environment(
        JSON.stringify({
          allowOnly: false,
          root: "<root>",
          snapshotOptions: { updateSnapshot: "new" },
        }),
      ),
      closures,
    },
  },
  {
    kind: "assemble",
    name: "an environment whose resolved config is not JSON, recorded as one field",
    why: "018 D1: a fake runner's config that is not JSON is one hashed field of the record and changes no key, at both trees alike",
    input: { files: FILES, environment: environment("{}+upgraded"), closures },
  },
  {
    kind: "assemble",
    name: "keys over a wrapped store, which records no environment",
    why: "018 D1: a `Proxy` of the store, as tests wrap one, has no connection of its own, so the record is skipped and the keys are as over the store itself, at both trees alike",
    input: { files: FILES, environment: environment("{}"), closures, wrappedStore: true },
  },
];
