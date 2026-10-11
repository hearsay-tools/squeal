import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// The scripts in evals/bin run as soon as they are imported (run-baseline.mjs starts a baseline),
// and typecheck does not cover .mjs, so a name imported from the wrong module only fails when
// the script runs. This reads each script's relative named imports and checks every name is
// exported where it is imported from, without running the script (006, 2026-10-11).
const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../../evals/bin");

describe("evals/bin imports", () => {
  for (const file of readdirSync(bin).filter((f) => f.endsWith(".mjs"))) {
    it(`${file} imports only names its modules export`, async () => {
      const source = readFileSync(join(bin, file), "utf8");
      const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/g)];
      for (const [, names, spec] of imports) {
        const mod = (await import(pathToFileURL(resolve(bin, spec as string)).href)) as Record<
          string,
          unknown
        >;
        for (const raw of (names as string).split(",")) {
          const name = raw.trim().split(/\s+as\s+/)[0];
          if (name) expect(Object.keys(mod), `${file}: ${name} from ${spec}`).toContain(name);
        }
      }
    });
  }
});
