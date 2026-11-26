import type { Case, PytestPython } from "../../case.js";

/*
 * Spec 027 D1, D2 (row 027-02): each pytest batch holds a slot and the
 * project's `env` expands `{slot}`, `{slot0}` and `{worktreeSlot}` per
 * batch. Slots are runtime isolation only: the keys read the templates, so
 * a release without slots keys and stores this project as the candidate
 * does. Six files make two batches of the default five; `slots.max` of 1
 * makes the second wait for the first's slot.
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const TEST = lines("def test_pass():", "    assert True");
const FILES = ["a", "b", "c", "d", "e", "f"].map((n) => `tests/test_${n}.py`);

export const PYTEST_SLOTS: readonly Case[] = (
  ["3.13"] as const satisfies readonly PytestPython[]
).map((python) => ({
  kind: "adapter:pytest",
  name: `batches wait for a slot and expand the env templates, Python ${python}`,
  why: "027 D1, D2: a batch's slot variables and expanded env change no key or stored outcome; the environment hash reads the unexpanded templates, and a capped pool makes a batch wait",
  input: {
    python,
    files: Object.fromEntries(FILES.map((path) => [path, TEST])),
    project: {
      env: {
        SQUEAL_VALIDITY_REDIS: "redis://127.0.0.1:6379/{slot}",
        SQUEAL_VALIDITY_DB: '{"dbname":"workers_{worktreeSlot}","index":{slot0}}',
        // Review 0.1.642 B2: Squeal composes these around the templates, which still expand.
        PATH: "/usr/bin:/bin:/tmp/squeal-validity-tools-{slot}",
        PYTHONPATH: "/tmp/squeal-validity-modules-{slot0}",
      },
      slots: { toxParallelEnv: true, max: 1 },
    },
    runs: [{ files: FILES }],
  },
}));

/** A pytest entry each release skips: an unknown key there, a `slots` value this tree refuses. */
const REFUSED = [{ max: 0 }, { toxParallelEnv: "yes" }, { enabled: false }, true];

export const SLOT_POLICY: readonly Case[] = [
  {
    kind: "assemble",
    name: "a repository whose pytest entries hold slots values this tree refuses",
    why: "027 D2.3: the loader refuses each slots value it cannot read and skips its project, as the last release skips a pytest entry with the unknown key, so the keys equal the last release's",
    input: {
      files: {
        "squeal.config.json": `${JSON.stringify({
          pytest: REFUSED.map((slots, i) => ({ name: `py${i}`, include: ["t/*.py"], slots })),
        })}\n`,
        "src/app.ts": "export const app = 1;\n",
        "test/app.test.ts": "import '../src/app';\n",
      },
      closures: [{ path: "test/app.test.ts", imports: ["src/app.ts"] }],
    },
  },
];
