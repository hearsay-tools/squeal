# Issue 233 throwaway probe

This fixture tests the surface of a blocked Vitest run, scoped stop/start, and recovery after an edit. It does not reproduce the original test or prove its cause.

From the Squeal checkout, with its dependencies already installed:

```sh
python3 research/probes/issue-233/probe.py
```

For the original wait lengths, run this command through the task's long-job tool:

```sh
python3 research/probes/issue-233/probe.py --wait-ms 60000
```

The script uses `node --disable-warning=ExperimentalWarning ~/.codex/plugins/data/squeal-hearsay/versions/0.1.531/dist/cli/squeal.mjs`. It reports the CLI version in its output. It creates a separate temporary Git repository and links the checkout's `node_modules`; dependencies are never committed. It refuses to start when one-minute load exceeds CPU count. The default Squeal run timeout stays 600 s; the deliberately unresolved test also has a 600 s Vitest timeout. `--wait-ms` changes only the two blocked CLI waits, not either execution timeout.

The passing control is followed by an edit that makes the test await forever. An ignored file confirms test entry. The script records selected status, a selected group run, JSON status, stop/start at unchanged inputs, and recovery after restoring passing code. It stops only its fixture's daemon and deletes the fixture only after cleanup exits 0. Each command has a subprocess bound; an exception still attempts cleanup. If cleanup fails, investigate the retained temporary fixture before removing it.

`output.jsonl` is the corrected short probe's command output, with home, checkout and temporary fixture paths replaced. It is test evidence, not an agent session transcript. Exit 0 overall; both deliberately blocked 1,500 ms waits returned 3. The probe used Squeal 0.1.531, Node v26.13.0, Vitest 5.0.3, one fork worker. No full suite or original incident repository ran.

`attempt-60s.txt` records the exact-wait attempt: exit 1 at the load guard (31.08 on 24 CPUs). No fixture or daemon was created for it. Do not cite it as a 60-second timeout reproduction.

Limits: linked dependencies caused a pnpm lock mismatch note and manifest-based dependency keys. The original Vitest version and effective config are unknown. A deliberate unresolved promise models only one possible kind of incomplete execution. All observed successful stop calls cleared the old run; a new run can block on the same unchanged test.
