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
 * Before the hub, this repository's own marketplace `squeal`: `squeal init`
 * migrates a repository set up with it, `squeal remove` names it while
 * settings hold it, and the Codex trust step names its hooks while Codex
 * lists them. The in-repo manifests keep the name until every machine has
 * moved to the hub (`research/probes/dev-marketplace`).
 */
export const PREVIOUS_MARKETPLACE_NAME = "squeal";
export const PREVIOUS_PLUGIN_ID = `${PLUGIN_NAME}@${PREVIOUS_MARKETPLACE_NAME}`;
