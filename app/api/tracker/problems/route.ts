import { listTrackerProblems, trackerAvailable, trackerFacets } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (Tracker archive, read-only): GET ?stage=&category=&grade=&branch=&year=&q=&offset= → problems + facets. */
export async function GET(req: Request) {
	const u = new URL(req.url).searchParams;
	if (!trackerAvailable()) return Response.json({ available: false, problems: [], total: 0, facets: null });
	const grade = Number(u.get("grade"));
	const list = listTrackerProblems({
		stage: u.get("stage") ?? undefined,
		category: u.get("category") ?? undefined,
		grade: Number.isInteger(grade) && grade > 0 ? grade : undefined,
		branch: u.get("branch") ?? undefined,
		year: u.get("year") ?? undefined,
		q: u.get("q") ?? undefined,
		offset: Number(u.get("offset")) || 0,
		limit: 200,
	});
	return Response.json({ available: true, ...list, facets: trackerFacets() });
}
