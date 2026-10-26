import hazard from "./eslint/hazard.js";

export default [{ plugins: { hazard }, rules: { "hazard/act": "error", "no-unused-vars": "error" } }];
