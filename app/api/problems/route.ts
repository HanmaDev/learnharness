import { applyProblemAction, parseProblemAction, problemLog } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * Fork (problem log): GET the whole log (categories, course defaults,
 * entries). POST one action — attempt / update / schedule / delete /
 * delete-attempt / add-category / rename-category / delete-category /
 * course-category — and get the log back.
 */
export async function GET() {
	return Response.json(problemLog());
}

export async function POST(req: Request) {
	const action = parseProblemAction(await req.json().catch(() => null));
	if (typeof action === "string") return Response.json({ error: action }, { status: 400 });
	const error = applyProblemAction(action);
	if (error) return Response.json({ error }, { status: error.startsWith("Unknown") ? 404 : 409 });
	return Response.json(problemLog());
}
