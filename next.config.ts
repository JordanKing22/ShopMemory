import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is already in Next's built-in serverExternalPackages list; listing it documents intent.
  serverExternalPackages: ["better-sqlite3"],
  // cacheComponents stays off on purpose: every DB read calls `await connection()` (PLAN.md §3.3).
};

export default nextConfig;
