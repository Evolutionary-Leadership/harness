import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";

// Reads the session, so it can never be prerendered.
export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  redirect(session ? "/notes" : "/login");
}
