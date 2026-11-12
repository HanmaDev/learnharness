import { trackerSolutionPage } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (problem archive): GET ?i=<n>&which=task|solution — the n-th original PDF page of a problem's statement or official solution, as a PNG. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const u = new URL(req.url).searchParams;
	const i = Number(u.get("i") ?? 0);
	const which = u.get("which") === "task" ? "task" : "solution";
	try {
		const png = await trackerSolutionPage(id, i, which);
		if (!png) return new Response("Not found", { status: 404 });
		return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
	} catch (e) {
		return new Response(`Render failed: ${e instanceof Error ? e.message : e}`, { status: 500 });
	}
}
