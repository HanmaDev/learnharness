import { isPlanDate, MAX_HEARTBEAT_SECONDS } from "@/src/core";
import { getChat, recordStudySeconds } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * Fork (statistics): POST { date: "YYYY-MM-DD" (the window's local day),
 * seconds, chatId? } — one active-time heartbeat from the study tracker.
 * Unknown chat ids count toward the day's total only.
 */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { date?: unknown; seconds?: unknown; chatId?: unknown } | null;
	if (!body || !isPlanDate(body.date)) return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
	const seconds = Number(body.seconds);
	if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_HEARTBEAT_SECONDS) {
		return Response.json({ error: `seconds must be 1-${MAX_HEARTBEAT_SECONDS}` }, { status: 400 });
	}
	const chatId = typeof body.chatId === "string" && getChat(body.chatId) ? body.chatId : null;
	try {
		recordStudySeconds(body.date, seconds, chatId);
	} catch (e) {
		return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 });
	}
	return Response.json({ ok: true });
}
