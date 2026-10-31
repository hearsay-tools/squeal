# Row 011-286: a synced named wait through a late heartbeat (gh-130 option A)

Wave 63 W1, slice. Worker 22c7e1d4, 2026-10-31. The human's decision (board row gh-130, card "#130: A: accept after sync"): when the wait's own sync succeeds and each selected file has a current result, the wait returns that verdict despite a late heartbeat.

## The rule

`readiness` (`src/cli/status-wait-paths.ts`) decides whether a read decides the selection. Before: only with `daemon.state === "alive"`. Now also with `lapsed` when all of these hold (`covered`):

- the wait's own sync is `synced` (the daemon stored its pass over the edits made before the wait);
- the store's revision is at or past that pass's revision, and the runner listed it (`!unlisted`);
- the selection has at least one file, and every selected file is `current`;
- the wait has no `--check`.

A read that is `covered` and ends `settled` sets `NamedWait.lapseCovered`. `namedResult` carries it on `SelectionRead.lapseCovered`. `selectionResult` (`src/cli/verdict.ts`) returns `none("lapsed")` only when `lapsed` holds without `lapseCovered`. Every other read keeps the `lapsed` gate first.

Why each condition holds the proof C6 asks for: the stored pass holds every edit made before the wait, and a current result is one at the file's key at a revision that holds them. Who validates next is not part of that proof.

## Unchanged, and why

- An accepting socket that never answers stores no pass: the sync stays `pending`, or turns `unsupported` after the CLI's 2 s socket timeout. Neither is `synced`, so exit 3 `lapsed`.
- An unstored pass (`pending`), a pass past the results' revision, an unlisted revision, a pending, stale or unknown selected file: not `covered`, exit 3 `lapsed`, as before.
- `no-daemon` (a `down` daemon) comes first in `selectionResult`, as before. `covered` needs `lapsed`, so the two never meet.
- `on-hold`, `paused`, `focused`: each needs a queued file, a file left for a pause, or `--check`. A covered read has every selected file current and no `--check`, so it ends `settled`, as a live daemon's read does. A lapsed read that ends in one of these has no `lapseCovered`, and `lapsed` is its reason, as before.
- `wait-liveness.ts`, the daemon, keys, the scheduler, the store: no change. No type in `src/core/types` changed.
- `status --wait` with no paths (`status-wait.ts`) and `status <path>...` without `--wait` (`status-paths.ts`): no change.

## Decisions the brief did not settle

1. **The lapse sentence.** I said it beside the verdict, with the existing words: when the wait's socket check found the daemon listening, the verdict line keeps `; the daemon's heartbeat went N s stale while its socket showed it alive (a busy store or a stalled daemon), so the wait went on` before `. Worktree:`. It is true: the wait went on through the lapse until its pass was stored. A wait whose first decided read came before the socket check answered has no sentence. The JSON snapshot beside the selection keeps `daemon: { state: "down", heartbeatLate }` (row 011-276). The words live in `status-wait-lines.ts` (`lapseText`), which this row does not own. If the coordinator wants words that say why the verdict stands, for example `the daemon's heartbeat is N s late, but its pass over the edits made before the wait is stored`, that is a change there.
2. **Every kind of lapse.** `covered` admits any `lapsed` reading: a plain late heartbeat, a handoff before its bound, and a start marked on the lock (`locked`). The proof is the stored pass and the current results, the same in all three. To keep it to the plain late heartbeat, add `daemon.locked !== true` and `stoppingOf(...) === undefined` to `readiness`.
3. **No `--check`.** A `--check` wait keeps the old gate. Its focused answer needs a run by the daemon. Admitting it would also turn the usage error (exit 2, no test file named by its own path) on during a lapse, where it gave exit 3 before: an exit code change outside this row.
4. **An empty selection.** `covered` needs at least one selected file. A wait whose paths select nothing keeps `lapsed`, not `unmatched`, during a lapse, as before.
5. **A path that selects nothing beside covered files.** The other paths' files are covered, so the reason is `unmatched` (exit 3) in place of `lapsed` (exit 3); a failure among them is `fail` (exit 1), as with a live daemon. The exit code for a selection with no failure is the same.

## Tests

- New `test/cli/status-wait-synced-lapse.test.ts`, through `main` with a stand-in daemon and a heartbeat 20 s old:
  - pass, exit 0, text verdict line: red before (exit 3);
  - pass in the JSON, `outcome: "settled"`, snapshot `heartbeatLate`: red before;
  - one selected test failing: fail, exit 1: red before (exit 3);
  - an accepting socket that never answers: exit 3 `lapsed` (guard, green before and after);
  - the pass not stored, and the pass at revision 5 with results at 4: exit 3 `lapsed` (guards);
  - the daemon recovers, then the pending file's run ends: pass, exit 0 (guard).
- `test/cli/selection-result.test.ts`: five table cases for `lapseCovered` (pass, fail, `unmatched` beside, `no-daemon` first, and `lapsed` without it).
- `test/cli/slow-wait-liveness.test.ts`, "gives a named slow file's verdict ...": it said the verdict waits for the heartbeat. It now checks the verdict comes before the heartbeat does (`back()` false at the end), so it fails on the base source, where the wait held until the heartbeat came back.
- The existing lapsed guard in `selection-result.test.ts` ("says lapsed beside a pending file") keeps exit 3 `lapsed` with a synced daemon and a pending file.

## For the coordinator

- Bundles: `plugins/*/dist` and the Codex runtime differ from the build after this change (`test/harness/plugin.test.ts`, `codex/packaging/runtime.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`). Not mine; the release build fixes them.
- Spec: C15's 2026-10-25 order puts `lapsed` second. The amendment for this row: `lapsed` holds unless the wait's own pass is stored at or before the results' listed revision and every selected file is current, without `--check`. C6 and C9 keep their text; C9's "a socket that accepts proves nothing" is the guard.
- `src/cli/status-wait-paths.ts` is 452 lines, over the 300-line guide before this row (421). `readiness` could move with `decidedOutcome` to a file of their own.
