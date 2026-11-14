import { heldUntilAsked } from "../../core/daemon/check-groups.js";
import { readPolicy } from "../../core/daemon/policy.js";
import { resolveCommonDir, worktreeIdFor } from "../../core/fs/git-layout.js";
import { readReleased } from "../../core/lint/pass/commit-entry.js";
import { waitsToLint } from "../../core/lint/pass/commit-news.js";
import { heldBy, lintGroupOf } from "../../core/lint/pass/moment.js";
import { lintScope } from "../../core/lint/pass/records.js";
import type { LintStore } from "../../core/lint/store/types.js";
import { type LintStoreSource, lintStoreSource } from "../../core/lint/surface/source.js";
import { groupView } from "../../core/scheduler/slow.js";
import { isBusy } from "../../core/store/connection.js";
import { isStoreOpenFailure, openStore } from "../../core/store/open.js";
import type { AbsolutePath, RevisionNumber, WorktreeId } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { LintTool } from "../../core/types/lint.js";
import type { Policy } from "../../core/types/policy.js";
import type { StatusUnavailable } from "../../core/types/status.js";
import type { Store } from "../../core/types/store.js";
import type { CheckpointLane } from "../../core/types/store-records.js";
import { holdOfWait, readClasses, readVerdict } from "../verdict.js";
import { checkpointFiles, inList } from "./covered.js";
import { presenceOf, presenceRead, readBound } from "./presence.js";
import { checkpointEnd, installWait, latestRevision } from "./progress.js";
import type { WaitPorts } from "./socket.js";
import type { ReadField, WaitRecord } from "./table.js";

/*
 * Row 011-326: what a run wait asks for, and the reads that fill its
 * record, each as the wait read it before the move: the same store calls,
 * the same files, the same busy timeout.
 */

/**
 * The files a run wait is for: a list, the request's covered files as the
 * scheduler recorded them (row 011-328, `requestFiles`), or, with no
 * record, a narrow run's selection from its answer; else today's guess, a
 * checkpoint's lane by the policy (`null`: both lanes, every listed file),
 * or a group's by the policy at the wait's start.
 */
export type WaitFiles =
  | { readonly kind: "lane"; readonly lane: CheckpointLane | null }
  | { readonly kind: "group"; readonly group: string }
  | { readonly kind: "list"; readonly files: readonly TestFileRef[] };

/** A checkpoint wait's files: its lane's, or its covered files. */
export type CheckpointFiles = Exclude<WaitFiles, { kind: "group" }>;

interface AskBase {
  readonly root: AbsolutePath;
  readonly socketPath: AbsolutePath;
  /** Epoch ms; `Infinity` for a bare `--wait`. */
  readonly deadline: number;
}

/** A run wait, by name, with its plain data. */
export type RunWaitAsk =
  | (AskBase & {
      readonly wait: "checkpoint";
      readonly checkpoint: {
        readonly id: string;
        readonly worktreeId: WorktreeId;
        readonly revision: RevisionNumber;
      };
      readonly files: CheckpointFiles;
    })
  | (AskBase & { readonly wait: "group"; readonly files: Exclude<WaitFiles, { kind: "lane" }> })
  | (AskBase & {
      readonly wait: "lint group";
      readonly files: Extract<WaitFiles, { kind: "group" }>;
    });

/** The fields a read fills; `store` and `unavailable` are the loop's. */
export type StoreField = Exclude<ReadField, "store" | "unavailable">;

/** One read's reader: the record's value for `field`. */
export type FieldReader = (field: StoreField) => Partial<WaitRecord>;

/**
 * The reads of `ask`, set up before its first read. Each read then takes
 * the open store; the lint group's takes none, as its counts open the lint
 * store. A field the wait's row does not reach is not read, and a field
 * its reader does not know throws.
 */
export function waitReads(ask: RunWaitAsk, ports: WaitPorts): (store: Store | null) => FieldReader {
  const { now } = ports;
  const late = () => ({ late: now() >= ask.deadline });
  switch (ask.wait) {
    case "checkpoint": {
      const { id, worktreeId } = ask.checkpoint;
      const presence = presenceOf(ask.root, worktreeId, ports);
      return (store) => {
        const lane = () => checkpointFiles(opened(ask, store), worktreeId, ask.files);
        return (field) => {
          switch (field) {
            case "late":
              return late();
            case "end":
              return { end: checkpointEnd(opened(ask, store), id) };
            case "revision":
              return { revision: latestRevision(opened(ask, store), worktreeId) };
            case "hold": {
              const s = opened(ask, store);
              const files = lane() ?? undefined;
              return {
                hold: holdOfWait(
                  s,
                  worktreeId,
                  () => s.testFileKeys.list(worktreeId, files),
                  now(),
                ),
              };
            }
            case "verdict":
              return { verdict: readVerdict(opened(ask, store), worktreeId, lane()) };
            case "daemon":
              return { daemon: presence(opened(ask, store)) };
            default:
              return unknownField(ask, field);
          }
        };
      };
    }
    case "group": {
      // Read once, as before the move: the group's view from the policy at the start, then the id.
      const own = ownOf(ask.root, ask.files);
      const id = worktreeIdFor(ask.root);
      const presence = presenceOf(ask.root, id, ports);
      return (store) => {
        /** The read's own files, which its hold and verdict read again. */
        let files: TestFileRef[] | null = null;
        const listed = (): TestFileRef[] => {
          files ??= opened(ask, store)
            .testFileKeys.list(id)
            .map((row) => row.testFile)
            .filter(own);
          return files;
        };
        return (field) => {
          switch (field) {
            case "late":
              return late();
            case "classes":
              return { classes: readClasses(opened(ask, store), id, listed()) };
            case "hold": {
              const s = opened(ask, store);
              const mine = listed();
              return { hold: holdOfWait(s, id, () => s.testFileKeys.list(id, mine), now()) };
            }
            case "verdict":
              return { verdict: readVerdict(opened(ask, store), id, listed()) };
            case "install":
              return { install: installWait(opened(ask, store), id) };
            case "daemon":
              return { daemon: presence(opened(ask, store)) };
            default:
              return unknownField(ask, field);
          }
        };
      };
    }
    case "lint group": {
      const presence = presenceOf(ask.root, worktreeIdFor(ask.root), ports);
      return () => (field) => {
        if (field === "late") return late();
        if (field === "counts") return lintRead(ask.root, ask.files.group, ask.deadline, now);
        // The lint group reads no worktree store but here, in a read of its own (row 011-327).
        if (field === "daemon") return { daemon: presenceRead(ask, presence, now) };
        return unknownField(ask, field);
      };
    }
  }
}

function opened(ask: RunWaitAsk, store: Store | null): Store {
  if (store === null) throw new Error(`run wait ${ask.wait}: no store is open for ${ask.root}`);
  return store;
}

function unknownField(ask: RunWaitAsk, field: StoreField): never {
  throw new Error(`run wait ${ask.wait}: its reads have no field ${field}`);
}

/** Which files a group wait is for: a list's (row 011-328; a narrow run's, row 019-49), else the group's. */
function ownOf(
  root: AbsolutePath,
  files: Exclude<WaitFiles, { kind: "lane" }>,
): (ref: TestFileRef) => boolean {
  if (files.kind === "list") return inList(files.files);
  const view = groupView(readPolicy(root));
  return (ref) => view.of(ref).name === files.group;
}

/**
 * `read` over the worktree's store, or `null` when it cannot be opened: the
 * reads beside a run wait (`run.ts`, `group-pending.ts`). A busy store
 * throws; the run waits' own reads go through `withStatusStore` (row 011-327).
 */
export function inStore<T>(
  root: AbsolutePath,
  read: (store: Store) => T,
  busyTimeoutMs = 1_000,
): T | null {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return null;
  const store = openStore(commonDir, { create: false, busyTimeoutMs });
  if (isStoreOpenFailure(store)) return null;
  try {
    return read(store);
  } finally {
    store.close();
  }
}

/** `withStatusStore`'s words before why a store was not read; a run wait's line names only why. */
const UNAVAILABLE_LEAD = "status unavailable, ";

/** Why the worktree's store was not read (row 011-327): "no Squeal store at …", "store busy, waited …". */
export function unavailableText(unavailable: StatusUnavailable): string {
  const { message } = unavailable;
  return message.startsWith(UNAVAILABLE_LEAD) ? message.slice(UNAVAILABLE_LEAD.length) : message;
}

/** The group's lint checks as the lint store has them. */
export interface LintCounts {
  readonly files: number;
  readonly failing: number;
  /** Checks that wait to lint (`waitsToLint`) and the pass lints: their tool's group is not held until asked, or their path is released. */
  readonly linting: number;
  /** Checks that wait to lint and wait for a commit or, at `manual`, a request: they changed after the request. */
  readonly held: number;
  readonly unknown: number;
}

/**
 * One read of the group's lint checks; why not, when lint is off or its
 * store cannot be read. Row 011-327 (review 0.1.474 B1), the worktree
 * store's rule: the lint store opens with `readBound`'s busy timeout, and a
 * busy error, at the open or in the read, is `busy` with why and whether the
 * deadline had passed when the read began, so the wait reads it again. Any
 * other failure stays `unread`. `withLint` reads both as `failed`, so this
 * read opens and closes the store itself.
 */
function lintRead(
  root: AbsolutePath,
  group: string,
  deadline: number,
  now: () => number,
): Partial<WaitRecord> {
  const policy = readPolicy(root);
  const commonDir = resolveCommonDir(root);
  if (!policy.lint.enabled || commonDir === null) return { counts: "off" };
  const id = worktreeIdFor(root);
  const tools = policy.lint.tools.filter((tool) => lintGroupOf(policy, tool)?.name === group);
  const { busyTimeoutMs, final } = readBound(deadline, now);
  const started = Date.now();
  let access: ReturnType<LintStoreSource["open"]> = null;
  try {
    access = lintStoreSource(commonDir, root, { busyTimeoutMs }).open();
    if (access === null || access === "missing" || "unreadable" in access) {
      return { counts: "unread" };
    }
    return { counts: countsIn(access.store, policy, id, tools) };
  } catch (error) {
    if (!isBusy(error)) return { counts: "unread" };
    const waited = Date.now() - started;
    return { counts: "busy", unavailable: lintBusyText(waited), late: final };
  } finally {
    if (access !== null && access !== "missing" && "store" in access) access.store.close();
  }
}

/** A busy lint read's why, in the words `withStatusStore` gives a busy worktree store. */
function lintBusyText(waited: number): string {
  return `lint store busy, waited ${waited} ms: another process holds the lint store's lock; run the command again once it is released`;
}

/** The group's lint checks in the open lint store, by its tools. */
function countsIn(
  store: LintStore,
  policy: Policy,
  id: WorktreeId,
  tools: readonly LintTool[],
): LintCounts {
  const counts = { files: 0, failing: 0, linting: 0, held: 0, unknown: 0 };
  for (const tool of tools) {
    // At `commit` and `manual` (row 019-47) only a release lints a check: one edited after it waits.
    const at = heldBy(policy, tool)?.at;
    const released =
      at !== undefined && heldUntilAsked(at) ? readReleased(store.meta, lintScope(id, tool)) : null;
    for (const state of store.states.list(id, { tool })) {
      counts.files += 1;
      // A stale check's outcome is an old one: it is no verdict until linted again (review 0.1.398 B1).
      if (waitsToLint(state)) {
        if (released === null || released.has(state.check.path)) counts.linting += 1;
        else counts.held += 1;
      } else if (state.outcome === "fail") counts.failing += 1;
      else if (state.outcome === "unknown") counts.unknown += 1;
    }
  }
  return counts;
}
