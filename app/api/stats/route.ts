import { statsView, toSerbianLatin } from "@/src/core";
import { problemLog, readStudyLogSafe, stores } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (statistics): GET /api/stats?course=<chatId> — the stats page data. */
export async function GET(req: Request) {
	const only = new URL(req.url).searchParams.get("course");
	const courses = [];
	for (const id of stores.chatStore.listChatIds()) {
		const chat = stores.chatStore.getChat(id);
		if (!chat) continue;
		courses.push({ id: chat.id, title: toSerbianLatin(chat.notes?.courseTitle ?? chat.title), messages: chat.messages, cards: chat.cards });
	}
	const course = only && courses.some((c) => c.id === only) ? only : null;
	return Response.json(statsView(courses, readStudyLogSafe(), Date.now(), course, problemLog().entries));
}
