import type { Case } from "../case.js";
import { ABSENT } from "./accept/absent.js";
import { FORMER } from "./accept/former.js";
import { HEAL } from "./accept/heal.js";
import { INHERIT } from "./accept/inherit.js";
import { RETIRED } from "./accept/retired.js";
import { SLOW_INHERIT } from "./accept/slow.js";
import { UNKNOWN_AFTER } from "./accept/unknown.js";
import { VITEST_ENVIRONMENT } from "./adapter/environment.js";
import { PYTEST_RUNS } from "./adapter/pytest.js";
import { VITEST_RUNS } from "./adapter/vitest.js";
import { DECLARED } from "./assemble/declared.js";
import { INHERITED } from "./assemble/inherited.js";
import { GOLDEN_KEYS } from "./key/golden.js";
import { INSTALLED_KEYS } from "./key/installed.js";
import { OBSERVED_READS } from "./observe/reads.js";
import { GOLDEN_ROWS } from "./rows/golden.js";
import { STORE_TIERS } from "./store/tier.js";

/**
 * The corpus: every case, run at both trees when the comparison fires. A case
 * joins with the change that needs it, under `cases/<kind>/`, and is not
 * deleted while its kind exists.
 */
export const CASES: readonly Case[] = [
  ...GOLDEN_KEYS,
  ...INSTALLED_KEYS,
  ...GOLDEN_ROWS,
  ...OBSERVED_READS,
  ...INHERIT,
  ...RETIRED,
  ...SLOW_INHERIT,
  ...UNKNOWN_AFTER,
  ...HEAL,
  ...FORMER,
  ...ABSENT,
  ...DECLARED,
  ...INHERITED,
  ...STORE_TIERS,
  ...VITEST_RUNS,
  ...VITEST_ENVIRONMENT,
  ...PYTEST_RUNS,
];
