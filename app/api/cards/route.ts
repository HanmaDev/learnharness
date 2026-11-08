import { cardsOverview } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (Kartice): every course's deck summary, for the sidebar and overview. */
export async function GET() {
	return Response.json(cardsOverview());
}
