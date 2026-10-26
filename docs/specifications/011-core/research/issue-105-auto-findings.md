# Keep automatic keying; prefer an explicit runtime-state exception

Researcher, row 011-261, issue [#105](https://github.com/hearsay-tools/squeal/issues/105).
**No automatic rule examined meets both requirements.** Write order, writer identity and repeated changes identify generated files, not their relevance to a verdict. Prefer the not-an-input setting if the human accepts its loss of coverage. This recommendation is not an approved design.

Versions: **S** = Squeal `3c6d3201bc2b6d3faa1be14e9842972cef371104` (0.1.359); **C** = cezarion `9a9f617f` and `ecdde7685`; **E** = the throwaway fixture at S, Node 24.21.0, Vitest 5.0.3, Linux. Store copies and probes: 2026-10-26 UTC (2026-10-27 locally). Sources and repeat commands are below and in [the probe README](probes/issue-105-auto/README.md).

| Question | Answer | Tag / version |
|---|---|---|
| 1. Candidate rules | An own-run write rule misses the hand-run incident. Learning that classification for later use also drops real generated inputs. A main-process hook closes some observation gaps, not the distinction between state and input. | inferred, S/C/E |
| 2. What they drop | The fixture's descriptor, build output, HTML and declared input all change before reads, with no source edit. The last three each change a verdict when edited alone. No examined rule passes. | verified by experiment, E; inferred, rule verdict |
| 3. Cost and validity | No passing automatic rule has a cost to recommend. Instrumentation needs new attribution and ordering. Excluding one input need not invalidate unrelated files, but filtering only new observations cannot remove the shared history. | read in source code, S; inferred, proposed changes |
| 4. Recommendation | Prefer a narrow, explicit exception. It covers hand-runs and idle-stop writes, but gives up validation for changes to that file alone. | inferred, S/C/E |

## 1. Signals and the incident

**Read in source code, S [S1–S3].** The recorder keeps unordered `f`/`w` sets. `observedInputs` removes a path the same test wrote, irrespective of order; `scratchOf` drops ignored descendants of written directories. Watcher changes name paths and hashes, not writers. Vitest 5.0.3 runs `globalSetup` outside workers, once per project instance. None supplies a “runtime state” fact.

| Rule | Evidence it would need | Does it cover the hand-run incident? | Failure |
|---|---|---|---|
| A: suppress a write before a reader in Squeal's current run | Ordered successful writes and reads, attribution to the run, coverage of all relevant writers | No: the agent's run and detached idle stop are outside that run | It cannot stop the original invalidation. Keeping the newly read bytes keyed can avoid redundant work within a run; that does not classify the file permanently. |
| A, learned: thereafter omit files written before their readers | A's evidence plus persistent classification, shared across readers/worktrees | Only after a qualifying run has taught it; it could then suppress external writes too | An output tested for correctness is also written before it is read. |
| B: omit outputs of `globalSetup` or its children | A project-level recorder in the main process; native tracing for non-Node writes; attribution through child lifetimes | Not directly for a hand-run outside that instrumentation; learned classification has A's limitation | Setup produces both state and tested builds. The producer is not proof of irrelevance. |
| C: omit paths changing on every run without other edits | Complete run boundaries, reader sets and content histories, including manual runs | Not on first sight; not necessarily on reuse or an idle stop | A build with an embedded nonce changes on every run too. Repeated passing verdicts prove nothing about the next changed value. |
| D: path, JSON shape, volatility, absence or import-only heuristics | Names/bytes, stat or access kind | A name rule can match the incident immediately | `.ai/qa/` holds the fixture's build and declared input too. PID/time-shaped JSON can be tested output. Dropping absence probes loses the HTML build check. Import-only loses file-read inputs. |

Table verdicts: **inferred, S/C/E**. A rule that protects declarations or lockfiles is stronger, but still loses undeclared build outputs. A hardcoded exception for this exact path can pass this sample; it supplies repository-specific meaning rather than deriving it from observations.

**Verified by experiment, E [E1].** Injecting the current recorder into Vitest's main process with synthetic `GLOBAL_SETUP` attribution sees direct Node writes and Node writes reached through a shell. It sees neither the shell's `printf` writes nor their order. Linux `strace -f` sees the shell opens with `O_TRUNC` before worker reads. Both kinds of producer write state and tested output. This proves observation is feasible on this host; it does not provide a production hook or safe suppression rule.

**Read in source code, C [C1].** Cezar's shell calls `node -e` to write the descriptor (`test-env-up.sh:640–683`), so a main-process hook could reach it through inherited settings. The detached Node watcher uses `markStopped`. Neither is covered when started independently. The descriptor also holds `baseUrl`, browser command/launch settings, served root and environment settings, consumed by `agent-browser.ts` and `environment.ts`. Whole-file suppression loses coverage beyond PID/time changes.

## 2. Apply the rules

**Read from store, copies taken at S/C [E1].** Cezar retains five ignored observed paths: descriptor (32 readers), HTML (7), `.agents/skills` (3), and `.e2e-fixtures/` plus its `package.json` (2 each). There are 78 descriptor revisions, 77 alone; 3 HTML revisions; and 6 pnpm lockfile revisions. Squeal has 67 classified ignored paths: 51 fixture probes and 16 `.ai/cezar/tmp/` probes; 62 npm and 1 pnpm lockfile revisions. These cover retained rows, not the earlier report's 22-hour window. Twelve Squeal paths beyond symlinks remain unclassified. Local ignore files were copied too; clean clones miss the Cezar scratch rules.

The stored `observed.*` maps contain test paths and path arrays, without writers, ordering or per-run observations. Applying A or B conservatively to these copies keeps all five/67 paths: no stored evidence authorizes dropping one. C cannot be computed exactly from these rows. “Changed alone often” selects the descriptor, but the lockfiles also have solo changes; it does not prove that readers caused any write. D's `.ai/qa/` rule selects only the descriptor among these Cezar observations and none of Squeal's. It appears successful on the copies, then fails E1. **Inferred, S and copied stores.**

**Verified by experiment, E [E1].** Two identical runs pass 8/8 tests and change all eight ignored outputs with clean git status. A hand-run of `e2e/d` records no target read/write but changes all eight through setup. Editing only the build, HTML or declared input from `GOOD` to `BAD`, then running its reader without setup, fails it. Two further mutations fail tests of PID-shaped Node outputs. These recorder/verdict probes ran no daemon; they do not measure stale passes under a proposed filter.

| Applied rule in E1 | Descriptor | Build read by `e2e/c` | HTML | Installed locks | Declared ignored input |
|---|---|---|---|---|---|
| Current worker recorder / written-directory bound | keep | keep | keep | keep | keep through read |
| A with complete ordering, permanently learned | drop | **drop** | **drop** | keep if protected | **drop**, unless protected |
| B, main Node hook only | keep the pure-shell descriptor; sees Node variants | keep pure-shell build; **drops Node variants** | keep here | keep if protected | keep here |
| B with native writes too | drop | **drop** | **drop** | keep if protected | **drop**, unless protected |
| C, every-run change | drop | **drop** | **drop** | keep if protected | **drop**, unless protected |
| D, `.ai/qa/` prefix | drop | **drop** | keep | keep | **drop**, unless protected |
| Explicit exception for descriptor alone | drop | keep | keep | keep | keep through read |

Table applications are **inferred from E1 and S**; bold entries violate the brief. Lockfiles use the separate `Lockfiles`/installed-dependency path, not observed reads; keeping them is an explicit constraint on these candidate filters, verified by source inspection, not a lockfile-mutation experiment. The fixture's ignored declaration is real config, but today's `#declarable` excludes ignored extras. Its read is what makes it an input; declaration alone is not protection [S2].

## 3. Cost and stored results

**Inferred from S [S1–S5].** A/B need main-process/project attribution and ordered records. Native tracing adds work at filesystem calls and follows children; production cost and cross-platform coverage are unmeasured. C needs histories beyond current unions and revisions, without proving independence. `results.ndjson` pairs every probe timing with one-minute load. These are not overhead benchmarks.

An explicit exception adds path matching, without writer instrumentation; cost is unmeasured. `SharedPaths` “merges and never prunes”; `setClosure` restores those paths, and `#release` protects them. Filtering only `observedGrowth` leaves the incident path active. Watcher-only suppression leaves keys claiming bytes that change unseen.

Unchanged closures/environments keep their keys; removing a present path changes its readers' keys [S5]. This supports affecting those files alone, but not relabelling old results at reduced keys. Reuse safety needs the candidate and C3's validity comparison. Raising `RECORDER_VERSION` or a shared environment version re-keys more files. Row 011-35 requires demonstrated meaning changes before a global format raise.

## 4. Recommendation and remaining questions

**Inferred, S/C/E.** Prefer a narrow not-an-input setting if this noise must stop. It supplies the missing claim from the repository owner and covers manual runs and detached writes without learning them first. Its failure case is explicit: a meaningful change to an excluded descriptor field alone will not re-run readers. Broad automatic suppression has that same failure and can silently apply it to builds and other inputs the owner meant to test. Keep current behavior until the human accepts that tradeoff.

Not determined: production cost and coverage of native tracing; a candidate's exact key-reuse boundary; whether every field in Cezar's descriptor is safe to exempt. No experiment on one repository can prove an ignored file's future semantic role from a finite write/read history. A proven hermetic producer with all inputs keyed could support a different argument, but C12's unobserved native/main-process reads mean Squeal has no such proof here.

## Sources

- **[E1]** [Probe README and commands](probes/issue-105-auto/README.md), `probe.py`, `run.sh`, `results.ndjson`. Both SQLite copies pass `PRAGMA quick_check`; no live database or daemon socket was opened.
- **[S1]** [Squeal at S](https://github.com/hearsay-tools/squeal/tree/3c6d3201bc2b6d3faa1be14e9842972cef371104): `src/runners/observe/{recorder,fs,spawn}.cjs`, `{read,inputs,runtime}.ts`; `src/runners/vitest/observe.ts`.
- **[S2]** Same revision: `src/core/scheduler/observed.ts` (`scratchOf`, `observedGrowth`); `keying.ts` (`setClosure`, `track`, `#release`, `#declarable`); `lockfiles.ts`.
- **[S3]** [Vitest 5.0.3](https://github.com/vitest-dev/vitest/tree/v5.0.3), installed package `node_modules/vitest/dist/chunks/index.DpLw24bj.js:12180` and `:21282`: `_initializeGlobalSetup` / `initializeGlobalSetup`.
- **[S4]** S: `src/core/keys/observed.ts` (`SharedPaths`); `src/core/store/schema.ts`; 011 C2, C3, C12 and `status.md`; 016 D4 and `research/ignored-paths.md`; `issue-105-findings.md` (earlier daemon E1).
- **[S5]** S: `src/core/keys/{check-key,key-format,environment}.ts`; `docs/process.md`; board row 011-35.
- **[C1]** [Cezarion at incident base](https://github.com/hearsay-tools/cezarion/tree/9a9f617f): `packages/web/e2e/{environment,agent-browser}.ts`; `.ai/scripts/test-env-up.sh:640`, `test-env-lease.mjs:359`. Read with `git show`; also checked at `ecdde7685`.
