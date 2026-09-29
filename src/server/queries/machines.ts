import "server-only";
/**
 * Server wrappers for machine pages and QR labels (src/lib/data/machines.ts). Each one awaits connection() first
 * (so the route stays dynamic and never ships prerendered seed data), then resolves the actor from the DB, then calls
 * the pure function with the demo clock's today and PUBLIC_BASE_URL (docs/DATA-LAYER.md).
 */
import { cache } from "react";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import {
  listMachineLabels,
  listMachines,
  machineDetail,
  machineLabel,
  type MachineDetailVM,
  type MachineLabelVM,
  type MachinesListVM,
} from "@/lib/data/machines";
import { requireActor } from "@/server/actor";
import { getDb } from "@/server/db";
import { getDemoToday } from "@/server/queries/shell";

/** The /machines list, with counts for the recent-issues window ending on the demo clock's today. */
export async function getMachinesList(): Promise<MachinesListVM> {
  await connection();
  const actor = await requireActor();
  return listMachines(getDb(), actor, await getDemoToday());
}

/** A machine page view model, or null for an unknown ID (the page calls notFound()). Memoized per request. */
export const getMachineDetail = cache(async (id: string): Promise<MachineDetailVM | null> => {
  await connection();
  const actor = await requireActor();
  const demoToday = await getDemoToday();
  return machineDetail(getDb(), actor, id, { demoToday, publicBaseUrl: getEnv().PUBLIC_BASE_URL });
});

/** One machine's 4 × 2 in QR label, or null for an unknown ID. Memoized per request. */
export const getMachineLabel = cache(async (id: string): Promise<MachineLabelVM | null> => {
  await connection();
  const actor = await requireActor();
  return machineLabel(getDb(), actor, id, getEnv().PUBLIC_BASE_URL);
});

/** Every machine's label, for the 8-up label sheet. */
export async function getMachineLabels(): Promise<MachineLabelVM[]> {
  await connection();
  const actor = await requireActor();
  return listMachineLabels(getDb(), actor, getEnv().PUBLIC_BASE_URL);
}
