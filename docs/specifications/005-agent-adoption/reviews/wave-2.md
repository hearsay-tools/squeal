# 005 wave 2 review

FAIL `2b0c55329395f02015f925852a0a7d6f0127dd5f`: **3 proven blockers**, **1 proven nonblocking should-fix**, no nits. The blockers are an incomplete D8 answer, execution of a truncated installer, and uninstalling a pre-existing plugin.

## Verification

HEAD matches the assigned candidate. Reviewed 005-14a, 005-14b, 005-20 and the 0.1.135 build in `7ca350ee..2b0c5532`, against brief 005-16, D3, D4, D5, D8 and their amendments. Intervening 001/006 work and previous review findings are outside this prosecution. No source or board changes, no delegation, no real Claude or Codex CLI, and no model session. Harness commands in probes use scratch homes and the existing stub harness executables.

Checks and probes ran at the exact candidate with a clean tracked tree, before writing this file. Build left both committed plugin distributions unchanged. This is the independent Vitest run, not Squeal's checkpoint.

```text
$ git rev-parse HEAD
2b0c55329395f02015f925852a0a7d6f0127dd5f
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
  @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
  esbuild@0.28.2 (postinstall: node install.js)
(exit 0)
$ npm run lint
> squeal@0.1.135 lint
> biome check .
Checked 957 files in 499ms. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.135 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.135 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.135 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --porcelain
(no output)
$ npx vitest run
FAIL test/cli/codex.test.ts:103:3
  touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI
  Error: Test timed out in 5000ms. (reported duration 7222ms)
FAIL test/cli/install-sh.test.ts:45:3
  changes nothing on a second run
  Error: Test timed out in 5000ms. (reported duration 8435ms)
FAIL test/harness/codex/plugin.test.ts:89:3
  gives every bundle a require for CommonJS dependencies, and each parses (003-12)
  Error: Test timed out in 5000ms. (reported duration 7979ms)
FAIL test/runners/node-test/graph-cost.test.ts:151:32
  re-resolves no slower than a cold build and re-parses an edit in under 5 % of it
  AssertionError: expected 1.0036284621116045 to be less than 1
Test Files  4 failed | 443 passed | 1 skipped (448)
Tests       4 failed | 3774 passed | 10 skipped (3788)
Duration    379.06s
(exit 1)
$ npx vitest run test/cli/install-sh.test.ts test/harness/codex/plugin.test.ts test/cli/codex.test.ts test/runners/node-test/graph-cost.test.ts test/e2e/shipped-plugin.test.ts --maxWorkers=1
Test Files  5 passed (5)
Tests       49 passed | 1 skipped (50)
Duration    27.80s
(exit 0)
$ node node_modules/vitest/vitest.mjs run --config <isolated-scratch>/config.mjs
Test Files  1 passed (1)
Tests       6 passed (6)
Duration    3.18s
(exit 0)
$ git status --porcelain
(no output)
$ test ! -e /tmp/node_modules
(exit 0)
```

The full suite is **red**. Three failing tests are unchanged in the range; the installer idempotence test is new. All four pass in the serial follow-up, which proves non-reproduction there, not the cause. Load sensitivity is plausible, not proven. No second full run sought green. These failures are recorded as verification evidence, not additional proven product blockers.

**Review-environment interference:** the first scratch probe config mistakenly used `/tmp` as Vitest's root. It created `/tmp/node_modules/.vite/vitest` and `.vite-temp` during the full run. The coordinator reported that this broke other runs' packaged-plugin isolation check. I verified that `/tmp/node_modules` held only those two cache directories and removed it, informed the coordinator, moved the probe config into its own `mkdtemp` directory, and reran all six probes there. The five-file follow-up above includes the packaged-plugin check after cleanup. The full run overlapped this contamination; it is not evidence for an uncontaminated green suite. None of its four reported errors was the packaged-plugin isolation assertion. All blocker evidence below reproduced in the isolated rerun. Scratch probes were removed before the report commit.

## Blockers

### B1. Proven: D8 denies a Vitest command that also runs unsupported typecheck files

**Location:** `src/harness/shared/test-command-files.ts:29`, especially its unfiltered return at line 31; caller `src/harness/shared/deny.ts:122`.

**Contract:** goal 7: “A command Squeal cannot resolve completely always runs.” D8 step 3: “One file pending, stale, unknown, unlisted or outside Squeal's runners, and the command runs.” The human's condition is never to answer for tests Squeal does not run.

**Failure:** a valid Vitest configuration enables typechecking alongside ordinary tests. Squeal's adapter deliberately excludes `typescript` pool specifications from its listing (`src/runners/vitest/adapter.ts:459`, pre-existing and not itself a finding). The new resolver treats that supported-only listing as the whole command's file set. With the four ordinary files current, `npx vitest run` is denied even though its fifth file, `test/outside.test-d.ts`, is outside Squeal's runner and has no result. The reason claims “the 4 test files it runs” and “no known failures”. Its later typecheck disclaimer does not make that command resolution complete.

**Independent probe:** the real Vitest adapter and `vitest list --filesOnly` on the same configuration disagree by the unsupported file; the public Claude Code `PreToolUse` hook denies. Both harness entries call this same resolver and transaction. No model or harness CLI runs in this probe.

```text
Configuration:
test: {
  include: ["test/*.test.ts"],
  typecheck: { enabled: true, include: ["test/*.test-d.ts"] }
}
Squeal adapter listing:
  test/each.test.ts
  test/greeting.test.ts
  test/math.test.ts
  test/strings.test.ts
Vitest list --filesOnly, from the hook's own worktree root:
  test/each.test.ts
  test/greeting.test.ts
  test/math.test.ts
  test/strings.test.ts
  test/outside.test-d.ts
PreToolUse(tool_name="Bash", tool_input.command="npx vitest run"):
  permissionDecision: deny
  The command did not run. Squeal holds current results at revision 1 for
  the 4 test files it runs (test/each.test.ts, test/greeting.test.ts,
  test/math.test.ts, test/strings.test.ts): 4 checks passed,
  no known failures, none inherited.
```

To reproduce with existing helpers in an isolated review test, import `openFixture` from `test/runners/vitest/helpers.ts`, `squealRepo`/`recorded` from `test/harness/helpers.ts`, `setKey`/`check`/`result` from `test/state/helpers.ts`, and `runHook` from the Claude adapter. The probe used this sequence:

```ts
const fx = await openFixture("basic", {
  "vitest.config.ts": `export default { test: {
    include: ["test/*.test.ts"],
    typecheck: { enabled: true, include: ["test/*.test-d.ts"] }
  } };`,
  "test/outside.test-d.ts": `import { expectTypeOf, test } from "vitest";
    test("bad type", () => expectTypeOf(1).toEqualTypeOf<string>());`,
});
const listing = await fx.adapter.testFiles();
const r = squealRepo();
cpSync(fx.root, r.root, { recursive: true });
symlinkSync(join(repoRoot, "node_modules"), join(r.root, "node_modules"));
const actual = execFileSync(process.execPath, [
  join(repoRoot, "node_modules/vitest/vitest.mjs"), "list", "--filesOnly",
], { cwd: r.root, encoding: "utf8" });
r.store.testFileKeys.remove(r.worktreeId, [{ project: "", path: "src/math.test.ts" }]);
for (const [i, file] of listing.entries())
  setKey(r.store, `kp${i}`, { file, worktreeId: r.worktreeId });
r.apply(...listing.map((file, i) => result(check("works", file), "pass", {
  key: `kp${i}`, worktreeId: r.worktreeId,
})));
r.policy({ testCommand: { denyWhenCurrent: true } });
const deps = { env: {}, ensureDaemon: async () => "alive" };
await runHook("session-start", recorded("session-start", r.root), deps);
const out = await runHook("pre-tool-use", recorded("pre-tool-use", r.root, {
  tool_name: "Bash", tool_input: { command: "npx vitest run" },
}), deps);
expect(actual).toContain("outside.test-d.ts");
expect(listing.some(f => f.path.endsWith("outside.test-d.ts"))).toBe(false);
expect(out.stdout).toContain('"permissionDecision":"deny"');
```

**One-worker fix:** make command resolution conditional on evidence that the runner listing covers the entire command, including unsupported pools. Persist the necessary completeness information with the daemon's listing, or conservatively fall through for configurations whose completeness cannot be established. Do not start Vitest or evaluate its config inside the hook, and do not infer safety by scanning config text. Add a real-listing fixture with mixed ordinary/typecheck files and public hook assertions for both harnesses: no deny, and no once-only slot consumed. Ordinary fully covered Vitest commands must still deny once. The off flag must still return before additional store work.

### B2. Proven: a download cut after the final `main` token runs the installer

**Location:** `install.sh:162`; coverage gap `test/cli/install-sh.test.ts:180`.

**Contract:** 005-14b done-when: “a cut download runs nothing.” Brief 005-16 specifically calls for checking this under `curl | sh`.

**Failure:** functions being complete before the last line protects line-boundary truncations, but not every byte-boundary truncation. The prefix ending in `main` is a valid shell command at EOF. It executes with no arguments, installs both plugins, and copies the launcher. The current test checks line cuts and one cut inside `"$@"`, skipping this executable prefix.

**Independent probe:** `machine()` from `test/cli/install-fixture.ts`, a fresh scratch home, stub CLIs and a `file://` hub:

```ts
const m = machine();
m.publish("0.1.135");
const script = readFileSync(INSTALL_SH, "utf8");
const cut = script.slice(0, script.lastIndexOf('main "$@"') + 4);
const out = m.sh([], { input: cut });
expect(m.calls()).toHaveLength(4);
expect(existsSync(join(m.home, ".local/bin/squeal"))).toBe(true);
```

```text
input suffix: }\n\nmain
exit: 0
calls:
  claude plugin marketplace add file://<scratch>/hub
  claude plugin install squeal@hearsay
  codex plugin marketplace add file://<scratch>/hub
  codex plugin add squeal@hearsay
launcher exists: true
```

**One-worker fix:** require a complete final invocation before `main` can mutate anything, for example a final quoted completion argument that `main` validates before choosing install/uninstall. A missing completion argument must be inert, not the default install mode. Keep the POSIX shell, no stdin reads and commands inside `main` contract. Test every proper byte prefix of the final invocation, including exactly `main`, `main ` and `main "$@"`; retain the existing line-prefix tests and a successful complete invocation. Include the uninstall invocation too.

### B3. Proven: uninstall removes a pre-existing plugin that this installer did not install

**Location:** `install.sh:144`, contrasted with `install.sh:91`.

**Contract:** brief 005-16: “`--uninstall` removing only what it installed”; 005-14b done-when: “`--uninstall` undoes it.”

**Failure:** install sees an existing user plugin and skips that harness. Uninstall later acts on every installed harness plugin, without remembering ownership. Someone taking the documented plugin-first path, then running `install.sh` just to obtain the terminal launcher, loses their earlier plugin when undoing the latter step. The launcher marker establishes its format, not whether this particular installer created it either.

**Independent probe:** install the plugin through the Claude stub first, then run the real script, then uninstall. All operations use one scratch home and its stub harness; Squeal itself writes no harness config.

```ts
const m = machine(["claude"]);
m.publish("0.1.135");
expect(m.sh(["-c", 'claude plugin marketplace add "$SQUEAL_MARKETPLACE" && claude plugin install squeal@hearsay']).status).toBe(0);
m.clearLog();
expect(m.sh([], { input: SCRIPT }).status).toBe(0);
expect(m.calls()).toEqual([]); // The installer created no plugin.
m.clearLog();
expect(m.sh(["-s", "--", "--uninstall"], { input: SCRIPT }).status).toBe(0);
const entries = JSON.parse(readFileSync(
  join(m.claudeConfig, "plugins/installed_plugins.json"), "utf8",
)).plugins;
expect(m.calls()).toEqual(["claude plugin uninstall squeal@hearsay"]);
expect(entries["squeal@hearsay"]).toBeUndefined();
```

```text
install's harness calls: []
uninstall's harness calls: ["claude plugin uninstall squeal@hearsay"]
uninstall exit: 0
installed plugin entries afterwards: {}
```

**One-worker fix:** record the resources this installer actually creates outside the harness config directories, preserving that ownership on repeated installs and partial failures. Uninstall must call only the owned harness removals and remove only its owned launcher; absent ownership must preserve an existing resource and say why. A format marker alone is not ownership. Test pre-existing Claude, pre-existing Codex, a mixed machine with one pre-existing plugin, a pre-existing launcher, repeated installation, and recovery after one harness fails. Keep all harness writes delegated to its own CLI. This can share an installer repair worker with B2.

## Should-fix

### S1. Proven, nonblocking: a new instruction file is omitted from the review and commit list

**Location:** `src/cli/setup/flow.ts:127` (untracked selection) and line 126 (`git diff` on untracked instruction files).

**Contract:** D3 step 5: “Show `git diff --stat` and the diff of every instruction file, and say what to commit.”

On a repository with no instruction file, setup correctly creates `AGENTS.md`, but Git's diff does not display it and the untracked query includes only `squeal.config.json` and `.claude/settings.json`. The output's commit list omits the new instruction file. This is a reviewability omission; the block itself is written correctly, so it is not a blocker against the wave's setup outcome.

**Probe:** `squealShaped()` fixture; remove and commit removal of `CLAUDE.md` and its `AGENTS.md` symlink; scratch Claude stub; `main(["setup", "--yes", "--no-warmup"], io)`. Exit 0, `AGENTS.md` exists, and the entire `Changes:` section is:

```text
Changes:
 squeal.config.json | 5 +++++
 1 file changed, 5 insertions(+)

Commit these when they look right; squeal setup never commits:
  squeal.config.json
  .claude/settings.json
```

**One-worker fix:** include new instruction files in the untracked selection and show their additions through a read-only diff against an empty file. Do not stage them to make `git diff` work. Test a fresh repo and both separate and symlinked instruction files, with every new managed file listed once.

## Nits

None.

## What fits

These observations concern the reviewed boundaries; they are not a blanket proof of all configurations.

- **D8:** the flag defaults false and is tested before recognition/store work. Recognition refuses shell composition, environment prefixes, changed runner/config/test flags, npm lifecycle siblings and unresolved filters. Pending keys, absent results, down daemons, pending runner reconciliation and absent consumers fall through. The decision and once-only record share one write transaction. Existing tests demonstrate subsequent commands and separate subagents; an additional public-hook probe confirms a registered session's `resume` preserves the deny record. Both harness parsers and entry points call the same shared interface, with regression denial first and at most one reason. B1 is the missing completeness proof, not a request to change those currentness rules.
- **Launcher:** both shipped copies are identical; first applicable Claude entry in file order is retained, and cross-harness selection takes the newer version and names the skew. Existing tests cover both entry orders, Codex alone and no installed plugin. Claude's own `bin/squeal` remains. The independent focused packaged-plugin test passes after scratch-cache cleanup.
- **Install/update:** real script tests use scratch homes, stub CLIs and a local hub. Node and harness prerequisites, private-hub failure, individual harness installs, launcher collision protection, idempotence and ordinary uninstall succeed in the focused run. Updates use the harness commands, preserve running-session wording and detect remaining skew. B2/B3 concern the uncovered prefix/ownership cases.
- **Setup, D3/D4/D5:** no terminal and no `--yes` lists the plan/questions without applying them. The fake-terminal, explicit answers, defaults and outdated-block tests pass. An extra two-harness probe with separate committed `CLAUDE.md` and `AGENTS.md` confirms both gates are reworded before block insertion; lint/typecheck/build remain in both lines, and both blocks are written. Trust uses `hooks/list` and the existing `init --trust` conversation through a stub. Setup never commits. S1 concerns the final display of new files.
- **Warm-up:** `setup` and standalone `warmup` share `warmUp`; it starts the terminal daemon then calls `run --all --wait`. The 0/1/3 fixture tests pass; code distinguishes no verdict and makes no success statement for exit 3. Fast-file duration suggestions do not apply writes. Ignored-path output is deliberately absent pending 001-307, as the brief/status explicitly allow.
- **Build/style:** lint and typecheck pass; no dependency or source rewrite by this review; rebuild produces no tracked bundle drift. Deferred skill/text/proof rows 005-15/19/18 are not treated as wave 2 omissions.

## Inputs for the fix and next waves

| Work | Ownership and dispatch contract | Done when |
| --- | --- | --- |
| D8 completeness repair (B1) | One worker on the listing-to-hook contract, with the 001 coordinator told before changing daemon listing metadata. Both harnesses keep `testCommandOf` before opening the store, then regression denial, then `denyCurrentTestCommand(context, command, policy.nodeTest, now)`. The decision/once write remains one transaction at the live revision. No extra hook process, no runner startup/config evaluation in the hook, off by default; retain the hook p95 budget under 10 ms. | Mixed ordinary/typecheck fixture falls through in both harnesses without consuming the once slot. A completely covered ordinary suite still denies once. Pending, stale, unknown, unlisted, unsupported or unrefined targets never produce an answer. |
| Installer repair (B2/B3) | One worker may own `install.sh` and installer fixture/tests for both. Define full-invocation validation before any side effect, plus persistent installer ownership outside `~/.claude`/`~/.codex`. Retain `main`, POSIX sh, no stdin reads, printed commands and stub-only tests. | Every proper prefix of the final invocation is inert. Complete install remains idempotent. Uninstall removes created resources and preserves pre-existing plugins/launchers, including mixed harnesses and partial failures. |
| Setup display (S1) | One small worker on `showChanges` and setup flow tests; no board edits or Git staging. | Every new instruction file's addition is shown and named once for commit; symlink aliases are deduplicated. |
| 001-307 integration | Already reserved: warm-up requests `observeIgnored: true` through the eventual CLI seam, then reads `readIgnoredReads(store, worktreeId)` for capped per-file suggestions. Do not guess ignored inputs or declare them automatically. | Only an explicit warm-up records suggestions; output calls them unkeyed until declared. This dependency is absent at the reviewed candidate by agreement. |
| Verification and remaining proof | Rebuild both plugin bundles at integration and retain the key-format guard. Re-review the three blocker probes against the fix candidate, then run the independent suite once. Keep scratch roots inside their own directories. No real harness or model sessions in the fix review; the coordinator owns the shared eval slot. | Findings and check output are at the same clean candidate; report any red/unverified checks honestly. 005-19/15 and then 005-17/18 retain their own briefs and budgets. |

The serial follow-up does not erase the full-suite red result. The installer test's 5 s timeout may need a test-only budget review if its normal work cannot reliably fit it; the isolated pass does not prove a timeout change is necessary. The pre-existing timing failures stay with their owning lane, not in this fix scope.
