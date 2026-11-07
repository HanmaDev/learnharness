import { cancelPhoneUpload, getChat, phoneUploadStatus, startPhoneUpload } from "@/src/server";

/**
 * Fork: "From phone". POST opens a one-time upload (a temporary listener on
 * this computer's Wi-Fi address, see src/server/phone-upload.ts) and
 * returns its QR code; GET ?token= polls it (the saved snapshot id once the
 * phone sent the photo); DELETE ?token= closes it early.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	try {
		return Response.json(await startPhoneUpload(id));
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : "Could not start the phone upload" }, { status: 503 });
	}
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const token = new URL(req.url).searchParams.get("token") ?? "";
	if (!/^[a-f0-9]{32}$/.test(token)) return Response.json({ error: "Bad token" }, { status: 400 });
	return Response.json(await phoneUploadStatus(token, id));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const token = new URL(req.url).searchParams.get("token") ?? "";
	if (/^[a-f0-9]{32}$/.test(token)) cancelPhoneUpload(token, id);
	return Response.json({ ok: true });
}
