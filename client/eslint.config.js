import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["build/**", "node_modules/**", "public/**"] },
  js.configs.recommended,
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react, "react-hooks": hooks },
    settings: { react: { version: "detect" } },
    rules: {
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "react-hooks/rules-of-hooks": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^[A-Z_]|^React$", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  { files: ["tests/**/*.mjs", "vite.config.js", "eslint.config.js"], languageOptions: { globals: globals.node } },
];
