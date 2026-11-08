import { trackerProblem } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (Tracker archive): one problem with tags and its solution pages. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const p = trackerProblem(id);
	return p ? Response.json(p) : Response.json({ error: "Not found" }, { status: 404 });
}
