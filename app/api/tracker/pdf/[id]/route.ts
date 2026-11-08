import * as fs from "node:fs";
import { trackerPdfFile } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (Tracker archive): a DMS source PDF (tasks / solutions), read-only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const file = trackerPdfFile(id);
	if (!file) return new Response("Not found", { status: 404 });
	return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { "content-type": "application/pdf", "cache-control": "private, max-age=3600" } });
}
