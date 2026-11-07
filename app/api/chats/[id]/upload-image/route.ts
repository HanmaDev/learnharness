import { getChat, normalizeImageBytes, stores } from "@/src/server";

/**
 * Fork: a learner photo (pasted, dragged, attached, or from the phone) —
 * the raw image bytes in the body. Normalized through the learner-image
 * path (format sniff, dimension check, re-encode ≤1600px/≈1MB, metadata
 * stripped) and saved as a session snapshot. Returns the snapshot id the
 * submission then carries; the model receives the image with it.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** DELETE ?snapshot=<id>: the learner removed it from the tray — dropped
 *  if nothing in the record uses it (a submitted photo is never removed). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const snapshotId = new URL(req.url).searchParams.get("snapshot") ?? "";
	if (!/^[a-f0-9]{64}$/.test(snapshotId)) return Response.json({ error: "Bad snapshot id" }, { status: 400 });
	return Response.json({ removed: stores.chatStore.removeUnusedPhoto(id, snapshotId) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const declared = Number(req.headers.get("content-length") ?? "0");
	if (declared > MAX_UPLOAD_BYTES) return Response.json({ error: "The photo is larger than 25 MB." }, { status: 413 });
	const bytes = new Uint8Array(await req.arrayBuffer());
	if (bytes.length === 0) return Response.json({ error: "Empty upload" }, { status: 400 });
	if (bytes.length > MAX_UPLOAD_BYTES) return Response.json({ error: "The photo is larger than 25 MB." }, { status: 413 });
	try {
		const image = await normalizeImageBytes(bytes, req.signal);
		stores.chatStore.savePhotoUpload(id, image.snapshotId, image);
		return Response.json({ snapshotId: image.snapshotId, width: image.width, height: image.height });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : "Could not read the photo" }, { status: 400 });
	}
}
