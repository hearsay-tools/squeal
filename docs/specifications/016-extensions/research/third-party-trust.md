# Research 016-06: trusting third-party checks

Date: 2026-10-24. Brief: `third-party-trust-brief.md`. Squeal read at HEAD `0822a4440`. Probes: `probes/third-party-trust/` (throwaway; Linux 6.8.0-147, Node 24.21.0, Python 3.12.3, strace 6.8). Web sources fetched on 2026-10-24; versions are listed under Sources.

Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Declaration | Every system makes the rule list its inputs (files, environment variables, tool versions) and hashes the list. Where the docs say how, the rule's own code enters the key: Bazel through the action's command line, Gradle through the task class and plugin classpath, Nx through the plugin's external dependencies, Jest through the transformer's own `getCacheKey`. Turborepo has no rule layer; the Pants and testmon pages read do not say. Buck2 also lets a tool report afterwards which declared inputs it used ("dep files"). **[docs]** |
| 2 | Under-declaration | Four answers: enforce (Bazel and Pants sandboxes, Buck2 under remote execution, Turborepo strict env mode), trace (Nx Ultracache), check the declaration's shape (Gradle validation), or trust it (Buck2 local, Bazel `local` strategy, testmon for non-Python files, Jest transformers). Each system that trusts the rule documents false cache hits. **[docs]** |
| 3 | Squeal's net | No. C12's recorder is Node-only. It sees a non-Node child's reads only when the spawn's arguments name the file. A ptrace tracer (`strace -f`) saw every read of every language in the probe. An `LD_PRELOAD` tracer missed a static binary. macOS was not tested. **[exp]** |
| 4 | Fault | No system examined attributes a wrong result to a rule after the fact. They do two things: the rule's version re-keys its own entries, and the cache is cleared. Squeal's `results` and `runs` rows record no provider name or version, so Squeal cannot drop one provider's results with a query. **[docs][src]** |
| 5 | Execution | No in-process permission model contains code that may spawn processes (Deno says so itself). VS Code and pre-commit gate on trust and pinning, not containment. On this host user namespaces are refused, and an unprivileged Landlock read allow list works. **[docs][exp]** |

## Findings

### Q1. Declaration and what enters the key

- **Bazel.** "Each action has inputs, output names, a command line, and environment variables. Required inputs and expected outputs are declared explicitly for each action." Only variables listed through `--action_env` enter the action. A rule's code enters only as the command and inputs it produces. Tools outside the workspace do not enter at all: "Bazel currently does not track tools outside a workspace … two users with different compilers installed will wrongly share cache hits" (issue #4558). **[docs]**
- **Buck2.** Rules are Starlark outside the binary. "Dep files allow commands to declare which subset of their inputs were used." A tool writes the list of inputs it used, and Buck2 skips a re-run when only unused inputs changed. **[docs]**
- **Gradle 9.8.2.** The key holds "the task type and its classpath", annotated input properties, "the classpath of the Gradle distribution, buildSrc and plugins", and the build script content when it affects the task. So a new plugin version re-keys every task the plugin runs. Caching is opt-in per task type (`@CacheableTask`). **[docs]**
- **Nx (24).** Inputs are file sets, `env`, `runtime` (a command whose output is hashed, "often used to include versions of tools") and `externalDependencies`. A target that names no external dependency hashes "all external dependencies of the workspace", because "Nx does not know which ESLint plugins are used". Executors from Nx-maintained plugins declare the correct set. **[docs]**
- **Turborepo.** A global hash and a task hash cover turbo.json, lockfile changes, `globalDependencies`, `env` and `globalEnv` values, and flags. Inputs are globs per task; no plugin layer. **[docs]**
- **Pants.** A plugin rule builds a `Process` with an `input_digest` and an explicit `env`. Ambient variables come only through `EnvironmentVarsRequest`. **[docs]**
- **pytest-testmon.** It tracks project code (coverage blocks), named environment variables, the Python version and package versions. It "doesn't know and doesn't track" static files or external services. **[docs]**
- **Jest.** A third-party transformer computes its own key (`getCacheKey`); Jest "highly recommend[s]" it but does not require it. **Vitest's** `cache` stores only failure, duration and last-run time, for ordering, never a result. **[docs]**

### Q2. Under-declaration and known incidents

- **Enforce.** Bazel: "Without action sandboxing, Bazel doesn't know if a tool uses undeclared input files … This can result in an incorrect incremental build." Its sandbox gives a working directory of declared inputs, but "processes can freely access all files on the file system" by absolute path. On Linux it needs user namespaces, and without them it falls back to symlinks or to none. Pants claims more: a sandbox "ensuring that cache keys are always accurate". Pants also caches a process only when it exits 0, and offers `ProcessCacheScope` for a process "that accesses files outside its sandbox". Turborepo strict mode (the default) removes undeclared variables from the task, so a missing declaration fails loudly instead of hitting a wrong cache entry. **[docs]**
- **Trace.** Nx Ultracache "traces the files a task reads when it runs on Workers" and in CI hashes the task "from the files it read on a recorded run instead of its declared file sets". Declared inputs become a floor only where marked `always`. The `warn` mode keeps the declared inputs authoritative. This is the same idea as C3's observed closure. **[docs]**
- **Validate shape.** Gradle fails a plugin whose task property has no input or output annotation ("up-to-date checking and caching won't work"), and reports undeclared dependencies between tasks. It cannot see a file the task reads without declaring it: "Missing task inputs can cause incorrect cache hits". **[docs]**
- **Trust.** Buck2: "currently does not sandbox local-only build steps"; for dep files, "If you fail to report some inputs you used … you'll get stale output." **[docs]**
- **Documented incidents.** Bazel: invalid uploads when an input changes during a build (issue #3360), and the compiler outside the workspace (#4558). Turborepo: a loose-mode build restored "a version of your application from cache that uses the preview environment's MY_API_URL". Gradle: a JDK 8u31 bug made output depend on source order, so buildSrc's classpath, and every custom task's key, varied. Jest 30.5.0 fixed three cache keys from third-party or configurable parts: the transformer key now includes the project config, "so editing a transformer's own settings invalidates what it cached" (#16331); ESM and CJS transforms no longer share a key (#16331); and haste-map key fields are delimited, "so two different option sets cannot hash to the same cache file" (#16352). Jest 30.5.2 fixed keys that "report[ed] the previous" version (#16422). **[docs]**

### Q3. Can C12's recorder, or a tracer like it, cover a provider in any language?

- **Squeal at HEAD.** C12's recorder wraps Node's `fs`, `child_process` and `Worker`. pytest's runtime (`src/runners/pytest/runtime/sitecustomize.py`) records only module imports through a `sys.meta_path` finder, not file reads. **[src]**
- **Probe `run.sh`.** One Node test file read six files: through Node, a Python `-c`, a dynamic C binary, a static C binary (path in argv and path in env), and `sh -c cat`. Squeal's recorder recorded 3 of 6. The two C files it recorded were named in argv; the same static binary reading a path from `$PROBE_DATA` was missed, and so were Python and `cat`. `strace -f` saw all 6. An `LD_PRELOAD` libc shim saw the dynamic binary's read and missed the static binary's. **[exp]** Go binaries on Linux are usually static and make syscalls without libc. An `LD_PRELOAD` tracer would miss them as it missed the static C reader. **[inf]**: Go is not installed here.
- **Limits on Linux.** ptrace works for a parent tracing its own descendants under `ptrace_scope=1` (this host). A container's seccomp profile may forbid it. It adds a stop per traced syscall; not measured here (no timings). eBPF and fanotify need root. Landlock enforces but does not report. **[inf]** for all but `ptrace_scope`, which was read on the host.
- **macOS: not determined, because** no macOS host was available and no named source covers tracing there. Bazel's docs name `sandbox-exec` for enforcement. Squeal's own Node recorder works on macOS as on Linux. **[inf]**
- Squeal does not depend on the recorder alone. C4's stability check re-stats every closure path after a tier and discards results whose inputs moved. That covers only declared or observed paths. **[src]**

### Q4. Attributing a wrong result

- No system examined names a faulty rule after the fact. The tools are: the rule version in the key (Gradle plugin classpath; Squeal's `adapterVersion`, which "re-keys that runner's checks alone", C14), a debug dump of each key input (Gradle `-Dorg.gradle.caching.debug=true`), clearing the cache (Bazel: "create a clean cache after a cache was poisoned"; "wiping the entire remote cache is not a feasible solution"), and limiting who writes (Gradle recommends `push = isCiServer`). Turborepo's HMAC signatures prove who wrote an artifact, not that it is correct. Buck1 let only CI write to the network cache; Buck2 lets everyone write "through sandboxed remote execution". **[docs]**
- **Squeal at HEAD.** `results` holds check, key, outcome, worktree, revision, commit and run id. `runs` holds worktree, revision and files. Neither records the runner or its version, which exist only hashed inside the key (`src/core/store/schema.ts`). Bumping a provider's version orphans its rows, and prune drops them after 7 days (C7). No query can remove one provider's results now, or name the provider of a stored result. **[src]**

### Q5. Executing third-party code beside an agent

- **Deno.** It is "sandboxed by default", but `--allow-run` is listed under "permissions that bypass the sandbox": "A subprocess runs as a separate program with its own permissions … whatever it does happens outside the sandbox." Test runners spawn processes, so an in-runtime permission model cannot contain a check provider. **[docs]**; the step to providers is **[inf]**.
- **VS Code.** Workspace trust gates what the folder brings (tasks, debug launches, restricted settings). Extensions declare `supported: true | false | "limited"`. But "Workspace Trust can't prevent a malicious extension from executing code and ignoring Restricted Mode." Trust is consent, not containment. **[docs]**
- **pre-commit.** A hook repository is pinned by `rev`, which pre-commit "assumes … is an immutable ref (such as a tag or SHA)". `--freeze` stores hashes in place of tags. "Isolated package environment" means dependency isolation. Docker hooks mount the repository read-write (`-v $PWD:/src:rw,Z`). **[docs]**
- **This host.** `unshare --user` is refused (`apparmor_restrict_unprivileged_userns=1`), so Bazel's `linux-sandbox` and bubblewrap cannot run here; 002's research saw Codex's bubblewrap fail the same way. An unprivileged Landlock ruleset (ABI 4) allowed reads under the worktree and denied a sibling directory, with no root. **[exp]**
- **Squeal today.** C10 says Squeal "never runs arbitrary commands" and runs only the project's own runner config. A SessionStart hook ensures the daemon in any repository with `squeal.config.json` (`src/harness/shared/session.ts`), with no prompt. **[src]** Today that runs only code the repository already holds: its tests and its runner. If a committed config names a provider fetched from a registry, opening a session would run code the repository does not hold. Principle 8 asks that "allowed commands … filesystem scope, environment access and secret handling are all visible and enforceable". **[inf]**

## Recommendation for Squeal

1. **Key on the provider's identity and declaration (Q1, Q4).** Put the provider's name, its exact version and the digest of its resolved configuration in the environment hash. Bazel shows what happens when a tool is not in the key (#4558); Jest's 30.5 fixes show the cost when a third party computes the key. The core should compute the key; the provider should give only inputs.
2. **Store the provider beside each result (Q4).** Store the provider name and version as provenance on the run or the result, outside the key, as commit and worktree are now. Then status can name the source of a verdict, and one command can drop a provider's results. No system examined has this. Squeal's shared store makes it worth the cost: a bad entry spreads to every worktree.
3. **A closure the core can check (Q2, Q3).** Require each provider to report the files a check read, as Buck2 dep files do. Run the core's net beside that report: C4's stability check on every provider, and, where a provider runs outside Node, a ptrace tracer on Linux as an optional observed set. Until a provider gives a closure the core can check, mark its results as such and keep them local to the worktree. **The tradeoff:** a ptrace tracer is language-independent but adds CPU per syscall, which the 2026-10-23 per-edit CPU rule weighs. A provider-reported closure costs nothing but is trusted. Measure the tracer before choosing.
4. **Trust and containment as two policies (Q5).** Run a provider only when the user's own config names it at a pinned version or digest, as pre-commit pins `rev`. Do not run a provider that the repository's committed config alone brings in, without the user's consent (VS Code's lesson). For containment on Linux, a Landlock allow list is available without root where user namespaces are blocked (the probe tested reads). Treat it as defence in depth: VS Code and Deno both say consent is the real boundary.
5. **Fidelity applies to providers.** The C10 Fidelity rule should bind a provider's injections as it binds Squeal's own: a verdict the tool itself would not give is a defect. **[inf]**

## Open questions

- macOS: is there a tracer for a non-Node provider without root (and with SIP on)? Not determined; it needs a macOS host.
- What `strace -f`, or a seccomp-notify tracer, costs per check on a real suite. Not measured because the host is loaded. It decides recommendation 3.
- Should a provider's result that only the provider's report covers be shared across worktrees? This is a policy choice for the spec.
- Landlock enforces but does not report what it allowed **[inf]**. Whether a newer kernel's audit support could turn it into a read tracer: not determined, because no named source covers it.

## Sources

- Bazel docs, fetched 2026-10-24: https://bazel.build/docs/sandboxing, https://bazel.build/basics/hermeticity, https://bazel.build/remote/caching
- Buck2: https://buck2.build/docs/rule_authors/dep_files/, https://buck2.build/docs/about/benefits/compared_to_buck1/, README at `facebook/buck2@94eab590` (2026-10-24)
- Gradle 9.8.2 user guide: https://docs.gradle.org/current/userguide/build_cache.html, `build_cache_concepts.html`, `build_cache_debugging.html`, `validation_problems.html`
- Nx (24) docs: https://nx.dev/recipes/running-tasks/configure-inputs, https://nx.dev/docs/reference/inputs, https://nx.dev/docs/concepts/how-caching-works
- Turborepo: https://turborepo.com/docs/crafting-your-repository/caching, `…/using-environment-variables`, https://turborepo.com/docs/core-concepts/remote-caching, https://turborepo.com/docs/reference/configuration
- Pants (stable): https://www.pantsbuild.org/stable/docs/introduction/how-does-pants-work, https://www.pantsbuild.org/stable/docs/writing-plugins/the-rules-api/processes
- pytest-testmon: https://testmon.org/, https://testmon.org/blog/determining-affected-tests/
- Jest: https://jestjs.io/docs/code-transformation; CHANGELOG at `jestjs/jest@61050e93` (30.5.0 to 30.5.2). Vitest: https://vitest.dev/config/cache
- VS Code: https://code.visualstudio.com/docs/editing/workspaces/workspace-trust, https://code.visualstudio.com/api/extension-guides/workspace-trust
- Deno: https://docs.deno.com/runtime/fundamentals/security/. pre-commit: https://pre-commit.com/
- Squeal at `0822a4440`: `docs/specifications/011-core/spec.md` C3, C4, C7, C10, C12, C14; `docs/decisions/0002-content-keyed-shared-store.md`; `src/core/store/schema.ts`; `src/runners/observe/*.cjs`; `src/runners/pytest/runtime/sitecustomize.py`; `src/harness/shared/session.ts`; `docs/specifications/002-codex-adapter/research/codex-hooks.md`
- Probes: `probes/third-party-trust/` (`run.sh`, `output.txt`, `sandbox.sh`, `sandbox-output.txt`)
