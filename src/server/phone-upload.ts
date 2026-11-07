/**
 * Fork (2026-11-07): "From phone" — a one-time photo upload from the
 * learner's phone over the local Wi-Fi.
 *
 * Security shape:
 *   - a SEPARATE tiny HTTP listener, started only for an open upload and
 *     closed after one image or 10 minutes (whichever first) — the app's own
 *     server never listens beyond loopback;
 *   - a 128-bit random token in the URL; every request without it is 403;
 *   - it serves exactly two things: the upload page (GET /u/<token>) and the
 *     upload itself (POST /u/<token>), one image ≤ 25 MB; anything else 404;
 *   - the bytes are held in memory until the app collects them, then run
 *     through the same normalizer as any learner image.
 */
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import QRCode from "qrcode";
import { normalizeImageBytes } from "../agent/tools/learner-image.ts";
import { chatStore } from "../store/chats.ts";

const TTL_MS = 10 * 60_000;
const MAX_BYTES = 25 * 1024 * 1024;

interface UploadSession {
	token: string;
	chatId: string;
	server: Server;
	url: string;
	expiresAt: number;
	state: "waiting" | "received" | "done" | "expired" | "failed";
	bytes?: Uint8Array;
	snapshotId?: string;
	error?: string;
	timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, UploadSession>();

/** The first private-range IPv4 of this machine (what the phone can reach). */
export function lanAddress(): string | null {
	const candidates: string[] = [];
	for (const list of Object.values(networkInterfaces())) {
		for (const a of list ?? []) {
			if (a.family === "IPv4" && !a.internal) candidates.push(a.address);
		}
	}
	const isPrivate = (ip: string) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
	return candidates.find(isPrivate) ?? null;
}

/** Uncollected photos are dropped after this long. */
const COLLECT_MS = 2 * 60_000;

function close(session: UploadSession, state: UploadSession["state"]): void {
	clearTimeout(session.timer);
	if (session.state === "waiting" || session.state === "received") session.state = state;
	session.bytes = undefined;
	session.server.close();
	session.server.closeAllConnections?.();
	// Review fix: never keep dead sessions (or their bytes) around.
	if (state === "expired" || state === "failed") sessions.delete(session.token);
}

export function uploadPage(token: string): string {
	// Self-contained, no external resources. Mobile-first.
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LearnHarness photo</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#141414;color:#eee}h1{font-size:20px}
label{display:block;margin:24px 0;padding:28px 16px;border:2px dashed #666;border-radius:14px;text-align:center;font-size:18px}
input{display:none}#s{margin-top:16px;font-size:16px}img{max-width:100%;border-radius:10px;margin-top:12px}</style></head>
<body><h1>Send a photo to LearnHarness</h1><p>Take a photo of your work (or choose one). It goes straight into your problem.</p>
<label>📷 Take or choose a photo<input id="f" type="file" accept="image/*" capture="environment"></label>
<div id="s"></div><img id="p" alt="">
<script>
const f=document.getElementById('f'),s=document.getElementById('s'),p=document.getElementById('p');
f.onchange=async()=>{const file=f.files[0];if(!file)return;p.src=URL.createObjectURL(file);s.textContent='Sending…';
try{const r=await fetch('/u/${token}',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
s.textContent=r.ok?'✓ Sent! You can close this page.':'Could not send ('+r.status+'). '+(await r.text());}catch(e){s.textContent='Could not send: '+e;}};
</script></body></html>`;
}

/** Open a one-time upload for a chat; returns the URL + its QR as SVG. */
export async function startPhoneUpload(chatId: string): Promise<{ token: string; url: string; qrSvg: string; expiresAt: number }> {
	// One open phone link per chat: a new one closes the old.
	for (const s of [...sessions.values()]) if (s.chatId === chatId && s.state === "waiting") close(s, "expired");
	const host = lanAddress();
	if (!host) throw new Error("No Wi-Fi/LAN connection found — connect this computer to the same network as your phone.");
	const token = randomBytes(16).toString("hex");
	const server = createServer((req, res) => {
		const session = sessions.get(token);
		const path = (req.url ?? "").split("?")[0] ?? "";
		if (path !== `/u/${token}`) {
			res.writeHead(path.startsWith("/u/") ? 403 : 404).end();
			return;
		}
		if (!session || session.state !== "waiting") {
			res.writeHead(410, { "Content-Type": "text/plain" }).end("This upload link has already been used or expired.");
			return;
		}
		if (req.method === "GET") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'" });
			res.end(uploadPage(token));
			return;
		}
		if (req.method !== "POST") {
			res.writeHead(405).end();
			return;
		}
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BYTES) {
				res.writeHead(413, { "Content-Type": "text/plain" }).end("The photo is larger than 25 MB.");
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (size > MAX_BYTES || res.writableEnded) return;
			if (size === 0) {
				res.writeHead(400, { "Content-Type": "text/plain" }).end("Empty upload.");
				return;
			}
			session.bytes = new Uint8Array(Buffer.concat(chunks));
			session.state = "received";
			res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
			// One image only: stop listening right away; the app has a little
			// while to collect it, then the bytes are dropped.
			clearTimeout(session.timer);
			server.close();
			session.timer = setTimeout(() => close(session, "expired"), COLLECT_MS);
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, host, () => resolve());
	});
	const port = (server.address() as { port: number }).port;
	const url = `http://${host}:${port}/u/${token}`;
	const session: UploadSession = {
		token, chatId, server, url, expiresAt: Date.now() + TTL_MS, state: "waiting",
		timer: setTimeout(() => close(session, "expired"), TTL_MS),
	};
	sessions.set(token, session);
	const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
	return { token, url, qrSvg, expiresAt: session.expiresAt };
}

/** Poll an upload: once the phone sent its photo, normalize + save it. */
export async function phoneUploadStatus(token: string, chatId: string): Promise<{ state: UploadSession["state"]; snapshotId?: string; error?: string }> {
	const session = sessions.get(token);
	if (!session || session.chatId !== chatId) return { state: "expired" };
	if (session.state === "received" && session.bytes) {
		const bytes = session.bytes;
		session.bytes = undefined;
		clearTimeout(session.timer);
		try {
			const image = await normalizeImageBytes(bytes);
			chatStore.saveImageSnapshot(chatId, image.snapshotId, image);
			session.snapshotId = image.snapshotId;
			session.state = "done";
		} catch (err) {
			session.state = "failed";
			session.error = err instanceof Error ? err.message : "Could not read the photo";
		}
		setTimeout(() => sessions.delete(token), 60_000);
	}
	return { state: session.state, snapshotId: session.snapshotId, error: session.error };
}

/** Close an upload early (the dialog was closed). */
export function cancelPhoneUpload(token: string, chatId: string): void {
	const session = sessions.get(token);
	if (!session || session.chatId !== chatId) return;
	close(session, "expired");
	sessions.delete(token);
}
