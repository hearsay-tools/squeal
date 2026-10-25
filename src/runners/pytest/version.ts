/**
 * Bumped when the adapter changes what a result, closure or environment means,
 * so the environment hash re-keys every check of this runner (001 D3, D4).
 * Alone in its file, as the other adapters' are (task 001-203).
 *
 * "4": the core keeps what runs imported (spec 016 D4): a git-ignored import
 * stays unless the run created or removed one of its directories, which the
 * runtime now records, imports key whatever `observe.runtimeInputs` says,
 * and what a process a test started imported stays `direct` after a
 * restart, so what is kept changes (the human, 2026-10-25).
 */
export const PYTEST_ADAPTER_VERSION = "4";
