import { notesView, stores } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (topic notes): every teaching course with a plan — for the notes overview. */
export async function GET() {
	const courses = [];
	for (const id of stores.chatStore.listChatIds()) {
		const chat = stores.chatStore.getChat(id);
		if (!chat?.tree || chat.kind === "practice") continue;
		const v = notesView(chat);
		courses.push({
			chatId: chat.id,
			title: chat.title,
			courseTitle: v.courseTitle,
			total: v.steps.length,
			written: v.steps.filter((x) => x.status === "written").length,
			taught: v.steps.filter((x) => x.status !== "untaught").length,
			updatedAt: v.steps.reduce<string | null>((m, x) => (x.updatedAt && (!m || x.updatedAt > m) ? x.updatedAt : m), null),
		});
	}
	return Response.json({ courses });
}
