import { wolframAvailable, wolframEqual } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * Fork (Wolfram): POST { expected, given } (plain/AsciiMath expressions) →
 * { verdict: "equal" | "different" | "undecided", available }. The exercise
 * form asks this only when its own check can't decide.
 */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { expected?: unknown; given?: unknown } | null;
	if (typeof body?.expected !== "string" || typeof body?.given !== "string") return Response.json({ error: "Body must be { expected, given }" }, { status: 400 });
	if (!wolframAvailable()) return Response.json({ verdict: "undecided", available: false });
	return Response.json({ verdict: await wolframEqual(body.expected, body.given, req.signal), available: true });
}
