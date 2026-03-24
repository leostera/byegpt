import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "store-assets/*.png", "extension/icons/*.png"],
  },
  js.configs.recommended,
  {
    files: ["extension/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },
  {
    files: [
      "scripts/**/*.js",
      "scripts/**/*.mjs",
      ".github/**/*.js",
      "tests-js/**/*.mjs",
      "vite.config.mjs",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
];
