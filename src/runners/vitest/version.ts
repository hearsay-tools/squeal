/**
 * Bumped when the adapter changes what a result, closure or environment means,
 * so the environment hash re-keys every check of this runner (D3, D4). Alone
 * in its file, which the key-format guard exempts (task 001-203), so a bump
 * leaves `KEY_FORMAT_VERSION` and the other runners' keys alone.
 */
export const VITEST_ADAPTER_VERSION = "2";
