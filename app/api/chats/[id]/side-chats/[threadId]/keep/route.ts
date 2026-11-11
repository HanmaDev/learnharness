import { keepSideAnswer } from "@/src/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; threadId: string }> };

/** Fork: POST { messageId, op: "notes" | "card" } — keep a side answer in
 *  the plan step's notes, or make a Kartice card from it. */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
	const { id, threadId } = await ctx.params;
	const body = (await request.json().catch(() => null)) as { messageId?: unknown; op?: unknown } | null;
	if (typeof body?.messageId !== "string" || (body.op !== "notes" && body.op !== "card")) {
		return Response.json({ error: "Body must be { messageId, op: \"notes\" | \"card\" }" }, { status: 400 });
	}
	const result = keepSideAnswer(id, threadId, body.messageId, body.op);
	return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status });
}
