// Throwaway probe for row 004-77: which CLI naming the Codex primer with slow
// files reaches, by the length of the command it names. Run from the repo root:
//   <tsx> docs/specifications/004-slow-suites/research/probes/atomic-flags-0215/primer-length.ts
import { primer } from "../../../../../../src/harness/shared/primer.ts";

const node = 'node --disable-warning=ExperimentalWarning "';
const tail = '/plugins/cache/hearsay/squeal/0.1.215/dist/cli/squeal.mjs"';
const homes = {
  "eval cell": "/tmp/squeal-evals-1001/cells/581f1772dc45/20261018T125937Z-bcdbec/a3-harmless.p0.codex-gpt-6-luna.e-medium.r3/codex",
  "typical user": "/home/someone/.codex",
};
const coverage = (requireSlowSuite: boolean) => ({
  vitest: true,
  vitestConfig: "vitest.config.ts",
  nodeTest: [],
  pytest: [],
  slow: { files: 1, requireSlowSuite },
});
for (const [label, home] of Object.entries(homes)) {
  const command = `${node}${home}${tail}`;
  for (const on of [false, true]) {
    // biome-ignore lint/suspicious/noExplicitAny: probe
    const text = primer(command, coverage(on) as any);
    const naming = text.includes(`${command} status --wait`)
      ? "names the CLI at the wait"
      : text.includes(command)
        ? "names the CLI only later"
        : "names no CLI path";
    const path = text.includes("<path>...") ? "path wait in" : "path wait out";
    console.log(`${label} (command ${command.length} chars), requireSlowSuite ${on}: ${text.length} chars, ${naming}, ${path}`);
  }
}
