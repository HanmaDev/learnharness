import { emit, isPlanDate, type PlanTarget } from "@/src/core";
import { getChat, stores } from "@/src/server";

/**
 * Fork: the plan view's target-date control. PUT { date: "YYYY-MM-DD" }
 * sets it, { date: null } clears it. Not a turn: the teacher learns of the
 * change with the learner's next input (inputAppends' plan-target notice).
 * Allowed mid-turn — the store's read/merge/write keeps it through the
 * turn's own persist.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { date?: unknown } | null;
	if (!body || !("date" in body)) return Response.json({ error: "Body must be { date }" }, { status: 400 });
	if (body.date !== null && !isPlanDate(body.date)) {
		return Response.json({ error: "date must be YYYY-MM-DD or null" }, { status: 400 });
	}
	const target: PlanTarget | null = body.date === null ? null : { date: body.date as string, setBy: "learner", at: new Date().toISOString() };
	if (target === null && !chat.planTarget) return Response.json({ planTarget: null });
	if (target && chat.planTarget?.date === target.date) return Response.json({ planTarget: chat.planTarget });
	stores.chatStore.savePlanTarget(id, target);
	emit("record-changed", { chatId: id });
	return Response.json({ planTarget: target });
}
