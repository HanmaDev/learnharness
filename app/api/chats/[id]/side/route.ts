import { applySideAction, getChat, parseSideAction } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * Fork (side chats): GET the session's side threads. POST one action:
 *   { op: "ask", text, threadId?, quote? }  → { threadId } at once; the
 *     answer lands in the record later (record-changed)
 *   { op: "close" | "reopen" | "delete", threadId }
 *   { op: "save-notes" | "make-card", threadId, messageId }
 * Threads are never part of the lesson transcript.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ threads: chat.sideThreads ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const action = parseSideAction(await req.json().catch(() => null));
	if (typeof action === "string") return Response.json({ error: action }, { status: 400 });
	const result = applySideAction(id, action);
	if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
	return Response.json({ ok: true, ...(result.threadId ? { threadId: result.threadId } : {}), threads: getChat(id)?.sideThreads ?? [] });
}
