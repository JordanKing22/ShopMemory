import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Provider SDKs may only be imported inside src/lib/ai/providers/* (CLAUDE.md hard rule 1).
const PROVIDER_SDKS = ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*", "@anthropic-ai/bedrock-sdk", "@anthropic-ai/bedrock-sdk/*", "@aws-sdk/*"];
// No telemetry / exporter libraries (hard rule 2).
const TELEMETRY = ["@opentelemetry/*", "@sentry/*"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: PROVIDER_SDKS, message: "Provider SDKs are imported only in src/lib/ai/providers/* — call runAI() instead." },
            { group: TELEMETRY, message: "Telemetry/exporter libraries are not allowed (CLAUDE.md hard rule 2)." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/ai/providers/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: TELEMETRY, message: "Telemetry/exporter libraries are not allowed." }] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
