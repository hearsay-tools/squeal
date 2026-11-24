# Issue 277 probe (throwaway)

Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-277/probe.mjs > docs/specifications/011-core/research/probes/issue-277/output.txt
```

This is one bounded synthetic mechanism probe, not a benchmark or a live daemon reproduction. It calls production `decidePresence`, `statusView`, `waitView`, `decideStatusWait` and `selectionResult` on supplied facts. It creates no store, socket or daemon and changes no existing one. The fixture supplies a held lock, no exit/start/stop marks, a pending sync and one current passing file. The wait receives synthetic `listening` socket evidence; the probe does not establish a real connection or reconciliation pass.

Source: package 0.1.627, commit `ad0de28f67a9eb9f7a4f21f77ffcec3edee8324c`. Node v26.13.0. Initial load check: `uptime; nproc` gave 4.29 / 14.43 / 23.94 and 16 CPUs. The saved run gave 1.6 / 7.87 / 19.29 and 16 available CPUs. The script refuses to run above the CPU count. Exit 0; all six readings asserted. See `output.txt`.

Probe development: the first invocation exited 1 on an incorrect expectation in the probe. With `sync: unsupported`, a waiting selection can use its fallback and the supplied timeout became `pending`, while the snapshot stayed `unsynced`. The fixture was corrected to supply `sync: pending` to model the intended unstored reconciliation case. The second invocation passed at load 2.32 / 10.5 / 21.4. Repeating after moving the probe under the owning spec passed again; that final run is saved above. No product source changed and no product suite ran.

The report is `docs/specifications/011-core/research/issue-277.md`. No dependencies or generated build are part of this probe.
