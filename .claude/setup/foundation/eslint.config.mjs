// eslint-config-next 16 ships native flat config (a default-exported array),
// so it is spread directly. Do NOT wrap it in @eslint/eslintrc's FlatCompat:
// the eslintrc validator tries to JSON.stringify the plugin objects and dies
// on a circular structure inside eslint-plugin-react.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },

  ...coreWebVitals,
  ...nextTypescript,

  {
    rules: {
      // Definition of done: no console.* outside src/lib/logger.ts.
      "no-console": "error",
      // `any` is banned outright; the escape hatch is `unknown` plus a Zod parse.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  {
    // The sanctioned console.* sites: the pino wrapper's own fallback, and the
    // scripts that run outside the app (migrate, seed) where stdout is the
    // entire interface.
    files: ["src/lib/logger.ts", "scripts/**/*.ts", "scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },

  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: { "no-console": "off" },
  },
];

export default config;
