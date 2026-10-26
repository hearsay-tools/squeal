// Core rules only, so no plugin version decides the findings.
export default [
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: {} },
    rules: { "no-unused-vars": "error", "no-undef": "error" },
  },
];
