import { parsePlacementRun, runPlacementCode } from "@/src/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Fork: POST { toolCallId, qid, code, which: "public" | "hidden" } — run a
 *  Test znanja code question's tests (taken from the stored call). */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
	const { id } = await ctx.params;
	const req = parsePlacementRun(await request.json().catch(() => null));
	if (typeof req === "string") return Response.json({ error: req }, { status: 400 });
	const result = await runPlacementCode(id, req);
	return "error" in result ? Response.json({ error: result.error }, { status: result.status }) : Response.json(result);
}
