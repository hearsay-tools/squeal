import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import probe from "eslint-config-probe";
import local from "./eslint/local.js";

export default [
  { ignores: ["dist/**", "eslint/**", "eslint.config.js"] },
  js.configs.recommended,
  probe,
  local,
  {
    files: ["**/*.js"],
    plugins: { "import-x": importX },
    rules: { "import-x/named": "error" },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
];
