import type { Case } from "../case.js";

/*
 * Spec 027 D4 (row 027-04): the loader reads `containers` and each
 * project's `container`. A declaration keys nothing yet, and a project that
 * names a target `containers` does not hold, or a `container` value this
 * tree refuses, is skipped, as the last release skips an entry with the
 * unknown `container` key: the keys equal the last release's.
 */

const TARGETS = {
  backend: {
    image: "sb/backend",
    network: "{composeProject}_default",
    workdir: "/app",
    keyMode: "image-id",
    dockerfileInputs: ["packages/backend/Dockerfile"],
    dependencyServices: ["db", "redis"],
    env: { DJANGO_SETTINGS_MODULE: "config.settings" },
  },
  workers: { image: "sb/workers" },
  bad: { image: "--privileged" },
  unknown: { image: "sb/x", privileged: true },
  none: {},
  "-name": { image: "sb/x" },
};

/** Entries each release skips: an undeclared target, a dropped one, values this tree refuses. */
const REFUSED: readonly unknown[] = ["frontend", "bad", "", 5];

export const CONTAINER_POLICY: readonly Case[] = [
  {
    kind: "assemble",
    name: "a repository that declares containers and whose projects name targets this tree skips",
    why: "027 D4: the loader keeps good targets, leaves out bad ones and skips each project whose container is undeclared or refused, as the last release skips an entry with the unknown key, so the keys equal the last release's",
    input: {
      files: {
        "squeal.config.json": `${JSON.stringify({
          containers: TARGETS,
          pytest: REFUSED.map((container, i) => ({
            name: `py${i}`,
            include: ["t/*.py"],
            container,
          })),
        })}\n`,
        "src/app.ts": "export const app = 1;\n",
        "test/app.test.ts": "import '../src/app';\n",
      },
      closures: [{ path: "test/app.test.ts", imports: ["src/app.ts"] }],
    },
  },
];
