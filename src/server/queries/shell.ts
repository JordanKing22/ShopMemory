import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { shopProfile } from "@/db/schema";
import { SafeError } from "@/server/safe";
import { getDb } from "@/server/db";

export interface ShellInfo {
  /** e.g. "Ridgeline Precision"; the UI always appends "(fictional)". */
  shopName: string;
  /** The non-dismissable banner text (shop_profile.fictional_notice). */
  fictionalNotice: string;
  /** Domain "today" (shop_profile.demo_today, YYYY-MM-DD). Format with formatDate() from @/lib/format. */
  demoToday: string;
}

/**
 * Shop-level facts for the app shell. Not role-gated (the shop name, the fictional notice and the demo date are
 * shown to every persona), so it doesn't need the actor. `await connection()` keeps every page dynamic.
 * Memoized per request (React cache), so the layout and a page share one read.
 */
export const getShellInfo = cache(async (): Promise<ShellInfo> => {
  await connection();
  const row = getDb()
    .select({ name: shopProfile.name, notice: shopProfile.fictionalNotice, demoToday: shopProfile.demoToday })
    .from(shopProfile)
    .get();
  if (!row) throw new SafeError("no_shop_profile", 'The shop profile is missing. Run "npm run seed".');
  return { shopName: row.name, fictionalNotice: row.notice, demoToday: row.demoToday };
});

/**
 * The demo clock's "today" (PLAN.md §5.1, §7.5): every tenure, departure, risk and KPI-window calculation uses this
 * instead of new Date(). Returns a YYYY-MM-DD string; pass it to monthsBetween() / formatDate().
 */
export async function getDemoToday(): Promise<string> {
  return (await getShellInfo()).demoToday;
}
