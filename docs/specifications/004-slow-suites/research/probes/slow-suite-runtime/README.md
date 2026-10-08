# Slow-suite runtime probes

Throwaway research, not production code or a benchmark guarantee. Board 004-02.

Examined Squeal 0.1.30 at `25580c8368d57dae987be84434b01e4f6da08cfa`, Cezar 0.15.1 at `13351da86ed4e44bb89ad54c284ab0115dc82c6b`, Node 24.21.0, Vitest 5.0.3, Linux 6.8.0-142-generic, 24 available CPUs and 46.65 GiB host RAM. Squeal tsx 4.23.15, Cezar tsx 4.23.0. All runs use private committed-source copies, with Squeal's literal `/tmp` paths and Cezar's Git preload temp path redirected under one `mkdtemp` root. For full verification, the scratch-path assertion also follows the private prefix; a never-executed command literal in the Codex hash fixture is preserved unchanged so its recorded hash remains valid. These containment edits are the only Squeal source/test changes in those copies. Copied builds are not the repository's live Squeal store.

Run `npm ci` in the research worktree first, then:

```sh
python3 setup.py /path/to/squeal /path/to/cezar
# Use only the returned private /tmp/sqr-* root below.
python3 measure.py /tmp/sqr-OWNED baseline
python3 measure.py /tmp/sqr-OWNED pair
python3 measure.py /tmp/sqr-OWNED limits
python3 measure.py /tmp/sqr-OWNED quota
# Recorded session also retried two setup-affected Cezar controls:
python3 measure.py /tmp/sqr-OWNED cz-controls
python3 collision.py /tmp/sqr-OWNED
python3 head-input.py /tmp/sqr-OWNED
python3 interruption.py /tmp/sqr-OWNED
python3 load.py /var/log/sysstat/sa07
```

Do not run those phases concurrently. A low-priority full Squeal verification run overlapped the Cezar affinity trial in the recorded session; that trial is not a calm baseline. The actual session ran limits before the rebuilt Cezar baseline. One low-priority companion (`nice -n 19`) is used in each paired trial, never a CPU burner. For Cezar, the initial copied `node_modules` and `dist` were stale; `stale-build.json` records that excluded trial. Two initial Cezar control trials also omitted a generated package README during manual setup; `exclusions.json` marks them unusable. The setup script now rebuilds each source before copying it. Final Cezar measurements follow `npm ci` and `npm run build:server` in scratch. The copied existing web build supplies package tests' static web artifact; browser behavior is not covered.

`measurements.ndjson` records full commands through mode, copy, files, prefix and concurrency. GNU time fields are wall seconds, user seconds, system seconds, maximum child RSS KiB (preceded by an exit-status line on failure). User+system CPU counts reaped descendants; detached daemons can escape this accounting. The sampler sums RSS of observed descendants every 100 ms and follows observed children after reparenting. It can miss a fast double fork and short-lived peaks, and shared pages can be counted more than once. Treat memory as a sampled process-tree footprint, not unique resident memory; CPU as a lower bound where detached children exist. The sampler itself used about 0.2 CPU and is outside its reported tree. Neither resource figure is an exact cgroup total.

Each trial is one observation on a shared host, with load recorded at start and end. A single-copy run means no deliberate companion from this probe, not a calm host. Cold Squeal full baseline includes fixture npm-cache population; subsequent runs use that private warm cache. No confidence intervals or causal speedup claims are justified. Node's reporter captures whole-file durations in full runs; Vitest JSON dates capture reported test execution spans, not external wall time or per-file CPU. Per-file CPU/RSS under simultaneous full-suite execution is not attributable by this sampler.

`collision.py` runs the real Cezar test named `free default port starts on the requested bind host`. It instruments only copy A to hold its successful listener until copy B exits. Copy B's test is unchanged. A passes; B fails because A owns `::1:4321`. This is forced overlap, not an estimate of natural race frequency. `collision.json` preserves the failure.

`interruption.py` appends a harmless comment to the running test file at 3 s. It measures finishing plus retry against cancelling plus retry, using fresh owned user systemd scopes so detached children are contained. The result is timing evidence, not a scheduler integration test; the product's discard rule is separately read in source. Files are restored in `finally`. A slow fixture's assertion failure still counts as a completed timing observation and is identified in the report.

`load-history.json` retains only queue/load values from sysstat, no process arguments or environment. Ten-minute samples establish sampled exceedance frequency; they do not prove how long load stayed continuously high between samples. `controls.json` records unprivileged control acceptance and the actual `cpu.max` value for a half-CPU scope. `docs-excerpts.json` retains fetched official documentation excerpts; exact installed tool versions are in the findings report.

All scratch repositories, logs, caches and fixture processes must be removed after extracting intended evidence. Stop only process groups/scopes started by these probes. Never remove the host's `/tmp/squeal-e2e-cache`, another task's scratch, or the real repository's store.

`results.md` contains every resource trial, with setup failures explicitly excluded. `file-durations.json` contains the full-command per-file spans, including paired runs. `outcomes.json` preserves test counts and failures. `verification.txt` holds the required gate output: two failures in the first contained full run were caused by containment fixtures, and the corrected two-file rerun passed all 13 tests. No production file was changed.

The unmodified Cezar full-suite pair also collided naturally: `task-cli.test.ts` in copy A failed to bind 127.0.0.1:4322, while copy B passed. This pair remains in the resource results with its failing outcome, unlike setup errors. The initial quota attempts could not reach the user bus because the minimal environment omitted its location; no tests started. Retries preserve only the non-secret `XDG_RUNTIME_DIR`/`DBUS_SESSION_BUS_ADDRESS` location alongside the existing minimal environment.

The recorded scratch root was removed after the process scan returned no remaining probe processes and no owned interruption scopes. `cleanup.json` records that checkpoint.
