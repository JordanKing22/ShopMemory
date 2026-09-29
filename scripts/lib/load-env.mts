// Import this FIRST in every script: loads .env / .env.local the same way Next.js does,
// and disables Next.js telemetry for anything the script spawns.
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });
process.env.NEXT_TELEMETRY_DISABLED = "1";
