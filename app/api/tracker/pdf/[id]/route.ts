import * as fs from "node:fs";
import { trackerPdfFile } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (problem archive): GET ?which=task|solution — the problem's original DMS PDF, read-only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const which = new URL(req.url).searchParams.get("which") === "solution" ? "solution" : "task";
	const file = trackerPdfFile(id, which);
	if (!file) return new Response("Not found", { status: 404 });
	return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { "content-type": "application/pdf", "cache-control": "private, max-age=3600" } });
}
