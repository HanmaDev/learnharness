import { applyMistakeAction, getChat, mistakesView, parseMistakeAction } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * Fork (mistake log): GET the course's mistakes with their analyses.
 * POST { op: "resolve" | "reopen" | "make-card", callId } or { op: "analyse" }
 * (retry the analysis of every mistake that has none yet).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(mistakesView(chat));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const action = parseMistakeAction(await req.json().catch(() => null));
	if (typeof action === "string") return Response.json({ error: action }, { status: 400 });
	const error = applyMistakeAction(id, action);
	if (error) return Response.json({ error }, { status: error === "Unknown mistake" ? 404 : 409 });
	return Response.json(mistakesView(getChat(id)!));
}
