import { listTrackerProblems, trackerAvailable, trackerFacets } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (problem archive, read-only): GET ?stage=&grade=&branch=&tag=&year=&difficulty=&kind=&q=&offset= → problems + facets. */
export async function GET(req: Request) {
	const u = new URL(req.url).searchParams;
	if (!trackerAvailable()) return Response.json({ available: false, problems: [], total: 0, facets: null });
	const int = (k: string) => {
		const n = Number(u.get(k));
		return Number.isInteger(n) && n > 0 ? n : undefined;
	};
	const list = listTrackerProblems({
		stage: u.get("stage") ?? undefined,
		category: u.get("category") ?? undefined,
		grade: int("grade"),
		branch: u.get("branch") ?? undefined,
		tag: u.get("tag") ?? undefined,
		year: u.get("year") ?? undefined,
		difficulty: int("difficulty"),
		kind: u.get("kind") ?? undefined,
		q: u.get("q") ?? undefined,
		offset: Number(u.get("offset")) || 0,
		limit: 200,
	});
	return Response.json({ available: true, ...list, facets: trackerFacets() });
}
