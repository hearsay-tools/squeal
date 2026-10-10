# 001-236 notes: the parcel root watch recovers an erased event

## The cause, on the root

`@parcel/watcher` 2.6.0, `src/Watcher.cc:124`, `Watcher::triggerCallbacks()`:

```cpp
auto error = mEvents.getError();
auto events = mEvents.getEvents();   // EventList's own lock, released
mEvents.clear();                     // the same lock, taken again
for (...) it->tsfn.BlockingCall(new CallbackData(error, events), callJSFunction);
```

The backend threads add events through `EventList::create/update/remove`, which take only `EventList::mMutex` (`src/Event.hh`), not the `Watcher::mMutex` held here. An event added between `getEvents()` and `clear()` is in neither the copy nor the list. Its `notify()` triggers the debouncer, whose `triggerCallbacks` then finds `mEvents.size() == 0` and delivers nothing. Every subscription shares this code, the root's included, so on macOS, where parcel watches the root (D2), an agent's or a build's write could be lost until the reconciliation pass. 001-235 found it on the extra-file subscriptions (`test/watcher/parcel-links.test.ts`); on the root it is shown by a fake parcel in `test/watcher/parcel-root.test.ts`, as 001-235's tests do. Not run on macOS (spec 001 non-goals).

## What the backend does now

`src/core/watcher/root-recheck.ts`, wired into the root subscription's callback in `parcel-backend.ts`. Timing argument: the erased write happened after this batch's copy and before its clear, so after the previous batch was taken and before this batch's JS callback runs. So each root batch:

- lists the directories its events name (the parent of each event path), skipping excluded ones;
- stats each entry that is not a directory, not excluded and not named, at most `ENTRY_BUDGET` (1,024) entries per batch, read one at a time through `opendirSync` so a huge directory is not listed whole;
- reports a `change` hint for each file whose mtime or ctime is no older than the previous batch's callback time less `RACY_NS` (2 s, the racy window 001-243 uses, moved here from `parcel-backend.ts`). The 2 s covers a coarse timestamp tick and the delay between parcel taking a batch and the JS callback running;
- a stat that fails other than ENOENT is reported, never trusted as unwritten.

It reads no file content, so the 001-245/247 read budget (4 MiB per parent's batch, for the extra-file recheck) is untouched; the stat count is the bound instead. A same-size rewrite in one tick is reported because the test is a time window, not a comparison with an old signature: there is nothing racy to trust.

Cost of being conservative: a file written for the next batch, or written within 2 s before the previous batch, is hinted now as well. Duplicate hints are already allowed (`update()`'s doc comment) and the reconciler drops a path whose hash did not change (D2), so the cost is a re-stat downstream.

## The bound, stated in D2

Not found by this, left to the reconciliation pass, which runs 30 s after the watcher goes quiet (D2; every batch pushes it back, `change-feed.ts` `armIdle`):

- an erased removal (nothing to stat; a per-directory listing baseline would find it but costs memory per directory and misses the first batch anyway);
- an erased write in a directory no event of the batch names (a whole-tree scan per batch is the reconcile pass);
- entries past the 1,024 of a batch;
- a write erased while the daemon's event loop held the previous batch's callback back for more than 2 s (the window starts at that callback).

Decisions the spec did not settle: the per-batch stat budget (1,024 entries), `kind: "change"` for every recovered hint (the feed uses only the path), and a new module `root-recheck.ts` beside `parcel-backend.ts` to keep that file under ~300 lines.

## Upstream issue: file it (text below), the coordinator files

Recommended: the fix is one locked swap, the race loses events on every platform, and our recovery is partial (removals, other directories). Text for `parcel-bundler/watcher`:

> **Title:** `Watcher::triggerCallbacks` can drop an event added between `getEvents()` and `clear()`
>
> **Version:** 2.6.0 (all backends).
>
> In `src/Watcher.cc`, `triggerCallbacks()` copies the pending events and then clears them in two separate steps:
>
> ```cpp
> auto events = mEvents.getEvents();
> mEvents.clear();
> ```
>
> Each step takes `EventList::mMutex` on its own, and the backend threads add events through `EventList::create/update/remove` without holding `Watcher::mMutex`. An event the backend adds between the two calls is in neither the copied vector nor the list after `clear()`. Its `notify()` triggers the debouncer, but the next `triggerCallbacks()` sees an empty list, so the event is never delivered.
>
> **Reproduction:** subscribe to a directory, then write two files back to back (`a.js`, then `b.js`) in a fresh process, many times. In about 1-2 % of runs locally (Linux, inotify) and in about a quarter of CI jobs on GitHub Actions, the callback receives `a.js` and never `b.js`.
>
> **Suggested fix:** take and clear the events in one locked step, e.g. an `EventList::takeEvents()` that swaps the map out under `mMutex` and returns its events (the error likewise). Then an event added concurrently lands either in the batch taken or in the list for the next one.
