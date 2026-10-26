import tseslint from "typescript-eslint";
import probe from "eslint-config-probe";
import crossFile from "eslint-plugin-probe";
import local from "./eslint/local.js";

export default [
  { ignores: ["dist/**", "eslint/**", "eslint.config.js"] },
  { rules: { "no-unused-vars": "error", "no-undef": "error" } },
  probe,
  local,
  {
    files: ["**/*.js"],
    // A rule that reads the file each import names, as import-x's `named` does.
    plugins: { "import-x": crossFile },
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
