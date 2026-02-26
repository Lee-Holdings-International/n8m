
import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "bin/**",
      ".agent/**",
      ".gemini/**"
    ]
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-undef": "off"
    }
  },
  // Test files: allow chai property-style assertions (expect(x).to.be.true, etc.)
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "no-unused-expressions": "off"
    }
  }
];
