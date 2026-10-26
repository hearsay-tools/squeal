import noFoo from "./rules/no-foo.js";

export default {
  plugins: { local: { rules: { "no-foo": noFoo } } },
  rules: { "prefer-const": "error", "local/no-foo": "error" },
};
