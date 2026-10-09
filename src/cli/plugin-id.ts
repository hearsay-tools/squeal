/*
 * The plugin id is `<plugin>@<marketplace>` in both harnesses. Released
 * Squeal installs from the hub marketplace `hearsay`
 * (`hearsay-tools/marketplace`, `research/release-hub.md`, row 001-164), so
 * every place that names the id takes it from here.
 */

/** The plugin's name in both harnesses' manifests. */
export const PLUGIN_NAME = "squeal";

/** The hub marketplace: its name, and the GitHub repository that holds both manifests. */
export const MARKETPLACE_NAME = "hearsay";
export const MARKETPLACE_REPO = "hearsay-tools/marketplace";

/** `squeal@hearsay`. */
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

/**
 * Before the hub, this repository was its own marketplace `squeal`; `squeal
 * init` migrates a repository set up then, and the Codex trust step names its
 * hooks while they are still installed.
 */
export const PREVIOUS_MARKETPLACE_NAME = "squeal";
export const PREVIOUS_PLUGIN_ID = `${PLUGIN_NAME}@${PREVIOUS_MARKETPLACE_NAME}`;

/**
 * This checkout as a marketplace, for developing Squeal: a distinct name, so
 * it can sit beside `hearsay` and installs `squeal@squeal-dev`.
 */
export const DEV_MARKETPLACE_NAME = "squeal-dev";
