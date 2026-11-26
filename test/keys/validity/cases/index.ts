import type { Case } from "../case.js";
import { ABSENT } from "./accept/absent.js";
import { FORMER } from "./accept/former.js";
import { HEAL } from "./accept/heal.js";
import { IMPORTED } from "./accept/imported.js";
import { INHERIT } from "./accept/inherit.js";
import { RETIRED } from "./accept/retired.js";
import { SLOW_INHERIT } from "./accept/slow.js";
import { UNKNOWN_AFTER } from "./accept/unknown.js";
import { OWN_COMPILE_CACHE } from "./adapter/compile-cache.js";
import { VITEST_ENVIRONMENT } from "./adapter/environment.js";
import { NODE_TEST_RUNS } from "./adapter/node-test.js";
import { PYTEST_RUNS } from "./adapter/pytest.js";
import { PYTEST_PDM } from "./adapter/pytest-pdm.js";
import { PYTEST_SLOTS, SLOT_POLICY } from "./adapter/pytest-slots.js";
import { VITEST_RUNS } from "./adapter/vitest.js";
import { VITEST_GLOBS } from "./adapter/vitest-globs.js";
import { VITEST_RECLOSURE } from "./adapter/vitest-reclosure.js";
import { VITEST_RESOLUTION } from "./adapter/vitest-resolution.js";
import { CHECK_GROUPS } from "./assemble/check-groups.js";
import { DECLARED } from "./assemble/declared.js";
import { DESCRIBED } from "./assemble/described.js";
import { ELSEWHERE } from "./assemble/elsewhere.js";
import { GATE_GROUPS } from "./assemble/gate-groups.js";
import { GLOB_LISTINGS } from "./assemble/globs.js";
import { INHERITED } from "./assemble/inherited.js";
import { PREPARE } from "./assemble/prepare.js";
import { REFUSED_OBSERVED } from "./assemble/refused.js";
import { REFUSED_WRITES } from "./assemble/refused-write.js";
import { REMOTE_KEY } from "./assemble/remote-key.js";
import { REWRITTEN } from "./assemble/rewritten.js";
import { RUNTIME_FILES } from "./assemble/runtime.js";
import { SHARED_REF } from "./assemble/shared-ref.js";
import { TEST_NEEDS } from "./assemble/test-needs.js";
import { WALKED } from "./assemble/walked.js";
import { GOLDEN_KEYS } from "./key/golden.js";
import { INSTALLED_KEYS } from "./key/installed.js";
import { PNPM_KEYS } from "./key/pnpm.js";
import { IGNORED_LISTING } from "./listing/ignored.js";
import { LEAVING_LISTING } from "./listing/leaves.js";
import { RECURSIVE_LISTING } from "./listing/recursive.js";
import { REWRITTEN_SCRATCH } from "./listing/rewritten.js";
import { FAILED_IMPORTS } from "./observe/failed-import.js";
import { OBSERVED_READS } from "./observe/reads.js";
import { OBSERVED_REWRITES } from "./observe/rewrites.js";
import { OBSERVED_STARTED } from "./observe/started.js";
import { OBSERVED_WRITTEN } from "./observe/written.js";
import { PRUNE_KEYS } from "./prune/keys.js";
import { PRUNE_SLICES } from "./prune/slices.js";
import { GOLDEN_ROWS } from "./rows/golden.js";
import { STORE_READS } from "./store/reads.js";
import { RUNTIME_STORES } from "./store/runtime.js";
import { STORE_TIERS } from "./store/tier.js";

/**
 * The corpus: every case, run at both trees when the comparison fires. A case
 * joins with the change that needs it, under `cases/<kind>/`, and is not
 * deleted while its kind exists.
 */
export const CASES: readonly Case[] = [
  ...GOLDEN_KEYS,
  ...INSTALLED_KEYS,
  ...PNPM_KEYS,
  ...GOLDEN_ROWS,
  ...OBSERVED_READS,
  ...OBSERVED_WRITTEN,
  ...OBSERVED_REWRITES,
  ...OBSERVED_STARTED,
  ...FAILED_IMPORTS,
  ...INHERIT,
  ...IMPORTED,
  ...RETIRED,
  ...SLOW_INHERIT,
  ...UNKNOWN_AFTER,
  ...HEAL,
  ...FORMER,
  ...ABSENT,
  ...DECLARED,
  ...CHECK_GROUPS,
  ...PREPARE,
  ...GATE_GROUPS,
  ...SHARED_REF,
  ...TEST_NEEDS,
  ...RUNTIME_FILES,
  ...INHERITED,
  ...REWRITTEN,
  ...ELSEWHERE,
  ...REFUSED_OBSERVED,
  ...DESCRIBED,
  ...REMOTE_KEY,
  ...IGNORED_LISTING,
  ...STORE_TIERS,
  ...STORE_READS,
  ...RUNTIME_STORES,
  ...VITEST_RUNS,
  ...VITEST_ENVIRONMENT,
  ...PYTEST_RUNS,
  ...PYTEST_PDM,
  ...PYTEST_SLOTS,
  ...SLOT_POLICY,
  ...NODE_TEST_RUNS,
  ...OWN_COMPILE_CACHE,
  ...LEAVING_LISTING,
  ...RECURSIVE_LISTING,
  ...REWRITTEN_SCRATCH,
  ...REFUSED_WRITES,
  ...PRUNE_SLICES,
  ...PRUNE_KEYS,
  ...WALKED,
  ...GLOB_LISTINGS,
  ...VITEST_GLOBS,
  ...VITEST_RESOLUTION,
  ...VITEST_RECLOSURE,
];
