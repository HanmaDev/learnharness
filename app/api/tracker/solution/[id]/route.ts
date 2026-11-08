import { trackerSolutionPage } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (Tracker archive): GET ?i=<n> — the n-th page of a problem's official solution, as a PNG. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const i = Number(new URL(req.url).searchParams.get("i") ?? 0);
	try {
		const png = await trackerSolutionPage(id, i);
		if (!png) return new Response("Not found", { status: 404 });
		return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
	} catch (e) {
		return new Response(`Render failed: ${e instanceof Error ? e.message : e}`, { status: 500 });
	}
}
