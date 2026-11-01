import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pathFirst, squealBin } from "../../evals/lib/index.mjs";
import { MissingPinCli, pinSqueal, retainCodexRuntime } from "../../evals/lib/prepare.mjs";

// Row 006-100: since e34c9bc1f (0.1.368) the Codex plugin is a fixed adapter with a frozen seed,
// and the commit's runtime is plugins/codex-runtime. The atomic run 20261031T221020Z-ec45fb on
// 0.1.387 still ran plugins/codex/dist/cli/squeal.mjs: ERR_MODULE_NOT_FOUND at the trust step,
// warm-up and end status, and 0 of 100 graded Codex cells showed a daemon.

const REPO = join(import.meta.dirname, "../..");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "squeal-pin-cli-"));
  dirs.push(d);
  return d;
};
const write = (p: string, s: string, mode = 0o644) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
  chmodSync(p, mode);
};
const says = (word: string) =>
  `console.log(${JSON.stringify(word)}, process.argv.slice(2).join(" "));\n`;
const CLI = "dist/cli/squeal.mjs";

/** A whole runtime root at `dir`, as the launcher's `runtimeAt` reads one. */
function runtimeTree(dir: string, version: string, word: string) {
  write(join(dir, "runtime.json"), JSON.stringify({ schema: 1, version, files: {} }));
  write(join(dir, ".codex-plugin/plugin.json"), JSON.stringify({ name: "squeal", version }));
  write(join(dir, CLI), says(word), 0o755);
  write(
    join(dir, "bin/squeal-launcher"),
    readFileSync(join(REPO, "plugins/codex/bin/squeal-launcher"), "utf8"),
    0o755,
  );
}

/** A pin before e34c9bc1f: each plugin carries its own CLI. */
function oldPin() {
  const pin = join(temp(), "pin");
  write(join(pin, "plugins/claude-code", CLI), says("pinned claude-code"));
  write(join(pin, "plugins/codex", CLI), says("pinned codex"));
  write(join(pin, "plugins/codex/hooks/hooks.json"), "{}");
  return pin;
}

/** A pin from e34c9bc1f on: a fixed adapter (hooks and seed) and the commit's runtime beside it. */
function newPin({ runtime = "0.1.387" }: { runtime?: string | null } = {}) {
  const pin = join(temp(), "pin");
  write(join(pin, "plugins/claude-code", CLI), says("pinned claude-code"));
  const adapter = join(pin, "plugins/codex");
  write(join(adapter, ".codex-plugin/plugin.json"), JSON.stringify({ version: "1.0.2" }));
  write(join(adapter, "hooks/hooks.json"), "{}");
  write(
    join(adapter, "bin/squeal-launcher"),
    readFileSync(join(REPO, "plugins/codex/bin/squeal-launcher"), "utf8"),
    0o755,
  );
  runtimeTree(join(adapter, "seed"), "0.1.368", "frozen seed");
  if (runtime) runtimeTree(join(pin, "plugins/codex-runtime"), runtime, "pinned runtime");
  return pin;
}

describe("the Squeal CLI of a pin (row 006-100)", () => {
  it("is each plugin's own CLI in a pin before the fixed Codex adapter", () => {
    const pin = oldPin();
    expect(pinSqueal(pin, "claude")).toEqual({
      cli: join(pin, "plugins/claude-code", CLI),
      runtime: null,
    });
    expect(pinSqueal(pin, "codex")).toEqual({
      cli: join(pin, "plugins/codex", CLI),
      runtime: null,
    });
  });

  it("is the commit's Codex runtime, not the frozen seed, once the adapter is fixed", () => {
    const pin = newPin();
    const runtime = join(pin, "plugins/codex-runtime");
    expect(pinSqueal(pin, "codex")).toEqual({
      cli: join(runtime, CLI),
      runtime: { root: runtime, version: "0.1.387" },
    });
    expect(pinSqueal(pin, "claude").cli).toBe(join(pin, "plugins/claude-code", CLI));
  });

  it.each([
    ["claude", oldPin, (pin: string) => rmSync(join(pin, "plugins/claude-code", CLI))],
    ["codex", oldPin, (pin: string) => rmSync(join(pin, "plugins/codex", CLI))],
    ["codex", () => newPin({ runtime: null }), () => {}],
    ["codex", newPin, (pin: string) => rmSync(join(pin, "plugins/codex-runtime", CLI))],
    [
      "codex",
      newPin,
      (pin: string) =>
        write(
          join(pin, "plugins/codex-runtime/.codex-plugin/plugin.json"),
          '{"version":"0.1.386"}',
        ),
    ],
  ] as const)(
    "for %s throws MissingPinCli when the pin has none (case %#)",
    (harness, make, breakIt) => {
      const pin = make();
      breakIt(pin);
      let error: unknown;
      try {
        pinSqueal(pin, harness);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(MissingPinCli);
      expect((error as Error).name).toBe("MissingPinCli");
      expect((error as Error).message).toMatch(/^missing pinned Squeal CLI for (claude|codex): /);
      expect((error as Error).message).toContain(pin);
    },
  );
});

describe("a Codex cell's retained runtime (row 006-100)", () => {
  it("is the pin's runtime under the cell's Codex data directory, selected as current", () => {
    const pin = newPin();
    const codexHome = join(temp(), "codex");
    const { runtime } = pinSqueal(pin, "codex");
    if (!runtime) throw new Error("no runtime");
    const cli = retainCodexRuntime(codexHome, runtime);
    const data = join(codexHome, "plugins/data/squeal-hearsay");
    expect(cli).toBe(join(data, "versions/0.1.387", CLI));
    expect(readFileSync(cli, "utf8")).toBe(says("pinned runtime"));
    expect(statSync(cli).mode & 0o777).toBe(0o755);
    expect(JSON.parse(readFileSync(join(data, "runtime/current.json"), "utf8"))).toEqual({
      schema: 1,
      version: "0.1.387",
    });
  });

  // The shipped launcher, given the cell as `codex plugin add` and the retained runtime leave it,
  // runs the CLI the cell's own Squeal commands run: the pin's runtime, not the seed.
  it("is what the shipped launcher runs in the cell", () => {
    const pin = newPin();
    const cell = temp();
    const codexHome = join(cell, "codex");
    const { runtime } = pinSqueal(pin, "codex");
    if (!runtime) throw new Error("no runtime");
    retainCodexRuntime(codexHome, runtime);
    const installed = join(codexHome, "plugins/cache/hearsay/squeal/1.0.2");
    for (const f of [
      "hooks/hooks.json",
      "seed/runtime.json",
      "seed/.codex-plugin/plugin.json",
      `seed/${CLI}`,
    ])
      write(join(installed, f), readFileSync(join(pin, "plugins/codex", f), "utf8"));
    mkdirSync(join(cell, "home"), { recursive: true });
    const env = {
      PATH: pathFirst(`${dirname(process.execPath)}:/usr/bin:/bin`, squealBin("codex", cell, pin)),
      HOME: join(cell, "home"),
      CODEX_HOME: codexHome,
      XDG_DATA_HOME: join(cell, "home/.local/share"),
      XDG_STATE_HOME: join(cell, "home/.local/state"),
    };
    const r = spawnSync("sh", ["-c", "squeal --version"], { env, cwd: cell, encoding: "utf8" });
    expect(r.stdout.trim()).toBe("pinned runtime --version");
    expect(existsSync(join(codexHome, "plugins/data/squeal-hearsay/versions/0.1.368"))).toBe(false);
  });
});

// run-baseline.mjs starts a run as soon as it is imported, so its wiring is read, not run (as
// eval-root.test.ts reads it): no test runs its exit 2.
describe("run-baseline.mjs before any cell (row 006-100)", () => {
  it("checks each arm's pin for each harness of the plan after building the pins", () => {
    const source = readFileSync(join(REPO, "evals/bin/run-baseline.mjs"), "utf8");
    const at = (s: string) => source.indexOf(s);
    const check = at('pinSqueal(join(ROOT, "pins", commit, arm), harness)');
    expect(check).toBeGreaterThan(at('buildPin(base, join(ROOT, "pins", commit, arm), arm, v)'));
    expect(source).toMatch(
      /for \(const arm of arms\)\s+for \(const harness of new Set\(config\.models\.map\(\(m\) => m\.harness\)\)\)/,
    );
    const stop = source.indexOf(
      "process.exit(2)",
      source.indexOf("e instanceof MissingPinCli", check),
    );
    expect(stop).toBeGreaterThan(check);
    for (const later of [stop, check])
      expect(later).toBeLessThan(Math.min(at("const plan = []"), at("async function runCell(")));
  });
});
