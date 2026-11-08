import { emit } from "@/src/core";
import { applyCardAction, courseCardsView, getChat, parseCardAction } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * Fork (Kartice): GET the course's deck — cards, today's queue, the rating
 * previews and the forecast. POST one learner action:
 *   { op: "review", cardId, rating: 1-4, correct? }
 *   { op: "flags", cardId, suspended?, known?, deleted? }
 *   { op: "enabled", enabled }
 * and get the updated deck back. Not a turn; allowed mid-turn (the store's
 * read/merge/write keeps it through the turn's own persist).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(courseCardsView(chat));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	const action = parseCardAction(await req.json().catch(() => null));
	if (typeof action === "string") return Response.json({ error: action }, { status: 400 });
	if (!applyCardAction(chat, action)) return Response.json({ error: "Unknown card" }, { status: 404 });
	emit("record-changed", { chatId: id });
	return Response.json(courseCardsView(getChat(id)!));
}
