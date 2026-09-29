import { redirect } from "next/navigation";

/** "/" opens the Knowledge Risk map (PLAN.md §9). */
export default function Home(): never {
  redirect("/risk");
}
