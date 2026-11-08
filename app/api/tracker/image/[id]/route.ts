import * as fs from "node:fs";
import { trackerImageFile } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (Tracker archive): a problem's statement image (read-only, inside the Tracker's managed folder only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const f = trackerImageFile(id);
	if (!f) return new Response("Not found", { status: 404 });
	return new Response(new Uint8Array(fs.readFileSync(f.file)), { headers: { "content-type": f.mime, "cache-control": "private, max-age=3600" } });
}
