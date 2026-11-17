import { testFileId } from "../keys/reverse-index.js";
import { onFirstParentLine, upstreamOf } from "../shared/choose.js";
import { fetchExport } from "../shared/fetch.js";
import { failureOf, gitCall, networkEnv, textOf } from "../shared/git.js";
import { FETCH_TIMEOUT_MS, LIST_TIMEOUT_MS } from "../shared/reader.js";
import { DEFAULT_SHARED_REF, EXPORT_NAME, refOf } from "../shared/refs.js";
import { sourceLabel } from "../store/imports.js";
import { decodeBundle, type ExportedResult, type ResultsBundle } from "../store/transfer-bundle.js";
import { importRefusal } from "../store/transfer-import.js";
import { commitSegments, keyOver, NO_PARTS, proven } from "../store/transfer-rekey.js";
import type { CheckId } from "../types/check.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { CheckKey, FileHash, TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type { Store } from "../types/store.js";
import type { ResultRecord } from "../types/store-records.js";
import type { KeyAt } from "./at-keys-checkout.js";
import { environmentsAt, type ProofInput, sameObserved } from "./at-keys-ci-proof.js";

/*
 * Row 023-17 (spec 023 D2, 018 D2, D11, D13, D14): before the checkout,
 * CI's export of the commit, `<shared.ref>/<sha>`, settles each file it
 * holds whose environment and key the 018 import accepts here: the file
 * takes the export's key re-keyed to this worktree's environment hash, and
 * its passes with origin `ci`, and needs no checkout. Files the export
 * leaves out (a failure, a file without a key, one left out for any other
 * reason) or does not prove go to the checkout as before.
 *
 * The export is read from the local ref first; only when the project sets
 * `shared.ref` and the clone lacks the ref is it fetched, once, under 018's
 * kill timers. Nothing is written to Squeal's stores, the git config, refs
 * or `FETCH_HEAD`; a fetch leaves unreachable objects, as 018's reader does.
 */

/** How the CI step reads the export. */
export interface CiCall {
  /** The kill timer of the one-ref listing; 018's `LIST_TIMEOUT_MS` by default. */
  readonly listTimeoutMs?: number;
  /** The kill timer of the fetch; 018's `FETCH_TIMEOUT_MS` by default. */
  readonly fetchTimeoutMs?: number;
}

/** What the CI step settled. */
export interface CiSettled {
  /** Each settled file's key and CI's results at it, by `testFileId`. */
  readonly files: ReadonlyMap<string, KeyAt>;
  /** The export's source (`sourceLabel`), when an export of the commit was read; else `null`. */
  readonly source: string | null;
  /** Why no export was read, when one was looked for and not found or refused; else `null`. */
  readonly missed: string | null;
}

export interface CiInput {
  readonly root: AbsolutePath;
  /** The commit, resolved. */
  readonly commit: string;
  /** The repository's store, read-only: the worktree's environment comes from it. */
  readonly main: Store | null;
  readonly policy: Policy;
  /** Each file's blob id at the commit (`committedBlobs`). */
  readonly blobs: ReadonlyMap<RelativePath, FileHash>;
  /** The call's variables, which the checkout's keyer reads (review wave-6 B2). */
  readonly env: NodeJS.ProcessEnv;
}

const NONE: CiSettled = { files: new Map(), source: null, missed: null };

/**
 * The files of `asked` (every exported file when `null`) that CI's export
 * of `input.commit` settles. Never throws for a missing, refused or
 * unreachable export: it settles nothing and says why in `missed`.
 */
export async function ciSettled(
  input: CiInput,
  asked: readonly TestFileRef[] | null,
  call: CiCall = {},
): Promise<CiSettled> {
  if (input.main === null || asked?.length === 0) return NONE;
  const read = await exportOf(input, call);
  if (typeof read === "string") return { ...NONE, missed: read };
  if (read === null) return NONE;
  const files = await settle({ ...input, main: input.main }, read, asked);
  return { files, source: sourceLabel(read.header), missed: null };
}

/** The export of the commit, a reason it was refused or not read, or `null` when there is none. */
async function exportOf(input: CiInput, call: CiCall): Promise<ResultsBundle | string | null> {
  const { root, commit, policy } = input;
  const prefix = policy.shared.ref ?? DEFAULT_SHARED_REF;
  const ref = refOf(prefix, commit);
  // 018 D14's trust bound: only an export of a commit on the default branch's first-parent line.
  const upstream = await upstreamOf(root);
  if (upstream === null) return null;
  const local = await localExport(root, ref);
  let bytes: Buffer | null = local;
  if (bytes === null) {
    // No network unless the project opts in (018 D14, decision filter 5).
    if (policy.shared.ref === null) return null;
    const fetched = await fetched1(root, upstream.remote, ref, call);
    if (fetched === null || typeof fetched === "string") return fetched;
    bytes = fetched;
  }
  if (!(await onFirstParentLine(root, upstream.branch, commit))) {
    return `${ref}: its commit is not on ${upstream.branch}'s first-parent line`;
  }
  const bundle = decodeBundle(bytes);
  if (typeof bundle === "string") return `${ref}: ${bundle}`;
  if (bundle.header.commit !== commit) {
    return `${ref}: its header names commit ${bundle.header.commit ?? "none"}`;
  }
  // Review wave-6 B3: the ref's name does not prove CI wrote it; the recorded source does.
  if (bundle.header.source.kind !== "github") {
    return `${ref}: ${sourceLabel(bundle.header)}, not CI's`;
  }
  const refusal = importRefusal(bundle);
  return refusal === null ? bundle : `${ref}: ${refusal}`;
}

/** The export file the local `ref` holds, or `null` without the ref. */
async function localExport(root: AbsolutePath, ref: string): Promise<Buffer | null> {
  const timeoutMs = LIST_TIMEOUT_MS;
  const oid = textOf(await gitCall(root, ["rev-parse", "--verify", "-q", ref], { timeoutMs }));
  if (oid === null || oid === "") return null;
  const blob = await gitCall(root, ["cat-file", "blob", `${oid}:${EXPORT_NAME}`], { timeoutMs });
  return blob.code === 0 ? blob.stdout : null;
}

/** `ref` from `remote`: one listing of that ref and one fetch; `null` when the remote has none. */
async function fetched1(
  root: AbsolutePath,
  remote: string,
  ref: string,
  call: CiCall,
): Promise<Buffer | string | null> {
  const env = await networkEnv(root);
  const listMs = call.listTimeoutMs ?? LIST_TIMEOUT_MS;
  const listed = await gitCall(root, ["ls-remote", remote, ref], { timeoutMs: listMs, env });
  if (listed.code !== 0) return `listing ${ref} on ${remote}: ${failureOf(listed, listMs)}`;
  const line = listed.stdout
    .toString("utf8")
    .split("\n")
    .find((l) => l.endsWith(`\t${ref}`));
  const oid = line?.split("\t")[0];
  if (oid === undefined || oid === "") return null;
  const timeoutMs = call.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
  const bytes = await fetchExport(root, remote, ref, oid, { timeoutMs, env });
  return Buffer.isBuffer(bytes) ? bytes : `fetching ${ref} from ${remote}: ${bytes.failed}`;
}

/**
 * Each exported file of `asked` the export proves here, with CI's results
 * at its key here: the environment and the observed rows the checkout
 * would key it with now are the export's (`at-keys-ci-proof.ts`).
 */
async function settle(
  input: ProofInput,
  bundle: ResultsBundle,
  asked: readonly TestFileRef[] | null,
): Promise<Map<string, KeyAt>> {
  const at = commitSegments(input.blobs);
  const wanted = asked === null ? null : new Set(asked.map(testFileId));
  const hashes = await environmentsAt(input, bundle);
  const results = new Map<string, ExportedResult[]>();
  for (const r of bundle.results) {
    const id = testFileId({ project: r.project, path: r.testPath });
    results.set(id, [...(results.get(id) ?? []), r]);
  }
  const out = new Map<string, KeyAt>();
  for (const file of bundle.testFiles) {
    const id = testFileId(file);
    if (wanted !== null && !wanted.has(id)) continue;
    const environment = bundle.environments.find((e) => e.project === file.project);
    const here = hashes.get(file.project) ?? null;
    if (environment === undefined || here === null || file.closure === null) continue;
    if (!proven(file, environment, at) || !sameObserved(input.main, bundle, file)) continue;
    const held = (results.get(id) ?? []).filter((r) => r.key === file.key);
    if (held.length === 0) continue;
    const key = keyOver(here, file, file.closure.paths, at, file.keyParts ?? NO_PARTS);
    out.set(id, { key, stored: held.map((r) => recordOf(r, key, bundle)) });
  }
  return out;
}

/** An exported result as a record at `key`, with origin `ci`: no store holds it. */
function recordOf(r: ExportedResult, key: CheckKey, bundle: ResultsBundle): ResultRecord {
  const check: CheckId =
    r.kind === "test"
      ? { kind: "test", project: r.project, testPath: r.testPath, fullName: r.fullName ?? "" }
      : { kind: r.kind, project: r.project, testPath: r.testPath };
  const { header } = bundle;
  return {
    check,
    key,
    outcome: r.outcome,
    durationMs: r.durationMs,
    location: r.location,
    fingerprint: null,
    summary: null,
    errors: [],
    provenance: {
      worktreeId: "ci",
      revision: 0,
      commit: header.commit,
      dirty: header.dirty,
      runId: sourceLabel(header),
      recordedAt: header.createdAt,
    },
    origin: "ci",
  };
}
