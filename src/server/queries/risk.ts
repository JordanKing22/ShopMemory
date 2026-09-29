import "server-only";
import { connection } from "next/server";
import { riskOverview, type RiskOverviewVM } from "@/lib/data/risk";
import { requireActor } from "@/server/actor";
import { getDb } from "@/server/db";

/** The Knowledge Risk view model for the current persona (departure-derived values gated by role). */
export async function getRiskOverview(): Promise<RiskOverviewVM> {
  await connection();
  const actor = await requireActor();
  return riskOverview(getDb(), actor);
}
