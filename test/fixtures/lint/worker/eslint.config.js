// Wave 1.8: a plugin that reads a file in a worker thread it starts, as
// synckit's plugins do (eslint-plugin-prettier, eslint-plugin-format).
import sync from "eslint-plugin-sync";

export default [
  { ignores: ["eslint.config.js"] },
  { plugins: { sync }, rules: { "sync/data": "error", "prefer-const": "error" } },
];
