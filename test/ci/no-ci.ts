/*
 * Row 023-93: a test that records and exports as a developer's checkout,
 * whatever CI variables the outer shell sets. Vitest sets `allowOnly` to
 * `!isCI` from std-env, which reads `process.env` once, when Vitest's node
 * API first loads. `squeal ci export` and the daemon harness load it in the
 * test's own process, so `CI: ""` given to the recording child alone left
 * the two sides apart under `CI=true`, and together by accident under
 * GitHub's `GITHUB_ACTIONS`.
 *
 * Import this module first in the test file: it removes every variable
 * std-env reads to detect CI from this process's environment before Vitest's
 * node API loads, so every child inherits a CI-free environment too, and
 * fails at load when Vitest still reads CI (a variable missing here, or the
 * node API loaded earlier).
 */

/** What std-env 4.3 reads to detect CI: `CI` and each provider's marker. */
const CI_MARKERS: readonly string[] = [
  "CI",
  "APPVEYOR",
  "AWS_APP_ID",
  "SYSTEM_TEAMFOUNDATIONCOLLECTIONURI",
  "INPUT_AZURE_STATIC_WEB_APPS_API_TOKEN",
  "AC_APPCIRCLE",
  "bamboo_planKey",
  "BITBUCKET_COMMIT",
  "BITRISE_IO",
  "BUDDY_WORKSPACE_ID",
  "BUILDKITE",
  "CIRCLECI",
  "CIRRUS_CI",
  "CF_PAGES",
  "WORKERS_CI",
  "K_SERVICE",
  "CLOUD_RUN_JOB",
  "CODEBUILD_BUILD_ARN",
  "CF_BUILD_ID",
  "DRONE",
  "DRONE_BUILD_EVENT",
  "DSARI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CI_MERGE_REQUEST_ID",
  "GO_PIPELINE_LABEL",
  "LAYERCI",
  "JENKINS_URL",
  "HUDSON_URL",
  "MAGNUM",
  "NETLIFY",
  "NEVERCODE",
  "RENDER",
  "SAILCI",
  "SEMAPHORE",
  "SCREWDRIVER",
  "SHIPPABLE",
  "TDDIUM",
  "STRIDER",
  "TEAMCITY_VERSION",
  "TRAVIS",
  "NOW_BUILDER",
  "APPCENTER_BUILD_ID",
  "STACKBLITZ",
  "STORMKIT",
  "CLEAVR",
  "ZEABUR",
  "CODESPHERE_APP_ID",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "DENO_DEPLOY",
  "DENO_DEPLOYMENT_ID",
  "FIREBASE_APP_HOSTING",
  "EO_PAGES_CI",
];

for (const name of CI_MARKERS) delete process.env[name];

const { configDefaults } = await import("vitest/config");
if (!configDefaults.allowOnly) {
  throw new Error(
    "test/ci/no-ci.ts: Vitest still reads CI; a CI variable is missing from CI_MARKERS, or Vitest's node API loaded before this module",
  );
}
