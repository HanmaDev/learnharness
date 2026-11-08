import { getChat, notesView, refreshNotes, revealNotesFile } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * Fork (topic notes): GET the course's notes view (steps, sections, file
 * path, what is being written). POST { op: "refresh" } writes every taught
 * step that is out of date (the current one too); { op: "reveal" } shows the
 * .md file in Explorer.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(notesView(chat));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { op?: unknown } | null;
	if (body?.op === "refresh") {
		const started = refreshNotes(id);
		return Response.json({ started, view: notesView(getChat(id)!) });
	}
	if (body?.op === "reveal") {
		return revealNotesFile(id) ? Response.json({ ok: true }) : Response.json({ error: "No plan yet" }, { status: 409 });
	}
	return Response.json({ error: "op must be refresh | reveal" }, { status: 400 });
}
