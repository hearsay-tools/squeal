import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POLICY_FILE, readPolicy } from "../daemon/policy.js";
import { compare } from "../fs/compare.js";
import { worktreeIdFor } from "../fs/git-layout.js";
import { coreEnvironmentInputs } from "../keys/environment.js";
import type { EnvironmentDescriptor } from "../keys/environment-descriptor.js";
import { observedModulesMetaKey } from "../keys/modules.js";
import { observedDirectMetaKey, observedMetaKey, readSharedEntries } from "../keys/observed.js";
import { observedStartupMetaKey } from "../keys/startup.js";
import { gitCall } from "../shared/git.js";
import { worktreeEnvironment } from "../store/environments.js";
import {
  type ExportedTestFile,
  OBSERVED_MAPS,
  type ResultsBundle,
} from "../store/transfer-bundle.js";
import { rekeyedHash } from "../store/transfer-rekey.js";
import type { AbsolutePath, ProjectName, RelativePath } from "../types/common.js";
import type { EnvironmentHash, FileHash } from "../types/keys.js";
import type { Store } from "../types/store.js";

/*
 * Row 023-17, review wave-6 B1 and B2: what must hold before a CI key
 * stands for the key the checkout at the commit would give now.
 *
 * B2: the environment. The checkout keys under the call's variables, read
 * through the commit's own `env.allowlist`, on this process's Node,
 * platform and arch. The worktree's recorded descriptor stands for the rest
 * only when those parts of it equal what the checkout would compute now;
 * then 018 D10 compares it with the export's (`rekeyedHash`). A missing
 * descriptor proves nothing.
 *
 * B1: the observed inputs. The checkout's keyer copies the repository's
 * shared observed rows (`observedFrom`), so its key holds what other runs
 * recorded. A CI key stands only when those rows, for the file and its
 * project's start-up, equal the ones the export carries, which its key was
 * computed with.
 */

const MAP_KEY = {
  observed: observedMetaKey,
  observedDirect: observedDirectMetaKey,
  observedModules: observedModulesMetaKey,
} as const;

export interface ProofInput {
  readonly root: AbsolutePath;
  readonly commit: string;
  readonly main: Store;
  readonly blobs: ReadonlyMap<RelativePath, FileHash>;
  /** The call's variables (`KeyingOptions.env`), as the checkout's keyer reads them. */
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Per exported project, the environment hash the checkout at the commit
 * would key it with now, when that can be proved without one; else `null`.
 */
export async function environmentsAt(
  input: ProofInput,
  bundle: ResultsBundle,
): Promise<Map<ProjectName, EnvironmentHash | null>> {
  const allowlist = (await commitPolicy(input)).env.allowlist;
  const now = envPart(allowlist, input.env);
  const worktreeId = worktreeIdFor(input.root);
  const out = new Map<ProjectName, EnvironmentHash | null>();
  for (const exported of bundle.environments) {
    const here = worktreeEnvironment(input.main, worktreeId, exported.project);
    const recorded = here?.descriptor ?? null;
    const proved = recorded !== null && sameMachine(recorded) && sameEnv(recorded.env, now);
    out.set(exported.project, proved ? rekeyedHash(exported, here) : null);
  }
  return out;
}

/** Whether the repository's shared observed rows of `file` and its project's start-up are the export's. */
export function sameObserved(main: Store, bundle: ResultsBundle, file: ExportedTestFile): boolean {
  for (const map of OBSERVED_MAPS) {
    const here = readSharedEntries(main, MAP_KEY[map](file.project))[file.path];
    if (!sameList(here, file.observed[map])) return false;
  }
  const startup = readSharedEntries(main, observedStartupMetaKey(file.project), "list")[""];
  const exported = bundle.observedStartup.find((s) => s.project === file.project)?.paths;
  return sameList(startup, exported);
}

/** The policy a checkout at the commit reads: the commit's own `squeal.config.json`, or the defaults. */
async function commitPolicy(input: ProofInput) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-at-policy-"));
  try {
    if (input.blobs.has(POLICY_FILE)) {
      const args = ["cat-file", "blob", `${input.commit}:${POLICY_FILE}`];
      const blob = await gitCall(input.root, args, { timeoutMs: 30_000 });
      if (blob.code !== 0) throw new Error(`squeal: cannot read ${POLICY_FILE} at ${input.commit}`);
      writeFileSync(join(dir, POLICY_FILE), blob.stdout);
    }
    return readPolicy(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The descriptor's `env` part a keyer computes from `env` under `allowlist` (`describeEnvironment`). */
function envPart(
  allowlist: readonly string[],
  env: NodeJS.ProcessEnv,
): EnvironmentDescriptor["env"] {
  const core = coreEnvironmentInputs({
    squealVersion: "",
    installedDependencies: "",
    allowlist,
    env,
  });
  const entries = Object.entries(core.env).sort(([a], [b]) => compare(a, b));
  const hash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return { names: entries.map(([name]) => name), hash };
}

function sameMachine(d: EnvironmentDescriptor): boolean {
  return (
    d.nodeVersion === process.version && d.platform === process.platform && d.arch === process.arch
  );
}

function sameEnv(a: EnvironmentDescriptor["env"], b: EnvironmentDescriptor["env"]): boolean {
  return a.hash === b.hash && sameList(a.names, b.names);
}

/** Equal as sets; an absent entry is an empty one. */
function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = [...new Set(a ?? [])].sort(compare);
  const right = [...new Set(b ?? [])].sort(compare);
  return left.length === right.length && left.every((v, i) => v === right[i]);
}
