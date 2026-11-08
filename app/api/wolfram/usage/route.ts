import { wolframAvailable, wolframUsage } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (Wolfram): this month's call count (free tier: 2,000). */
export async function GET() {
	return Response.json({ available: wolframAvailable(), ...wolframUsage(), limit: 2000 });
}
