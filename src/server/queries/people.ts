import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { listPeople, personProfile, type PeopleListVM, type PersonProfileVM } from "@/lib/data/people";
import { requireActor } from "@/server/actor";
import { getDb } from "@/server/db";

/** The knowledge holders for /people (departure gated by role). */
export async function getPeopleList(): Promise<PeopleListVM> {
  await connection();
  const actor = await requireActor();
  return listPeople(getDb(), actor);
}

/**
 * One holder's profile, or null (the page calls notFound()). Memoized per request with React cache(), so
 * generateMetadata and the page share one read.
 */
export const getPersonProfile = cache(async (id: string): Promise<PersonProfileVM | null> => {
  await connection();
  const actor = await requireActor();
  return personProfile(getDb(), actor, id);
});
