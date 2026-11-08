import { generateCardDrafts, getChat, MAX_GENERATE, resolveEngine } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * Fork (Kartice): POST { nodeId: "<step id>" | "weak", count } → { drafts }.
 * Nothing is stored here: the learner reviews the drafts and keeps the
 * ones they want through POST /api/chats/[id]/cards { op: "add", drafts }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { nodeId?: unknown; count?: unknown } | null;
	const nodeId = body?.nodeId;
	const count = body?.count;
	if (typeof nodeId !== "string" || !nodeId) return Response.json({ error: "nodeId must be a step id or \"weak\"" }, { status: 400 });
	if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_GENERATE) {
		return Response.json({ error: `count must be 1-${MAX_GENERATE}` }, { status: 400 });
	}
	let engine;
	try {
		engine = resolveEngine("teacher");
	} catch (e) {
		return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 });
	}
	if (!engine) return Response.json({ error: "Nije podešen model (Settings → Providers)." }, { status: 503 });
	try {
		const { drafts, nodes } = await generateCardDrafts({ chat, nodeId, count, engine, signal: req.signal });
		return Response.json({ drafts, nodes });
	} catch (e) {
		return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
}
