"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, XIcon } from "lucide-react";

/**
 * Fork (2026-11-07): the "From phone" dialog — shows the QR code for a
 * one-time upload link on this computer's Wi-Fi, polls until the phone has
 * sent its photo, and hands back the saved snapshot id.
 */
export function PhoneUploadDialog({ chatId, onClose, onPhoto }: { chatId: string; onClose: () => void; onPhoto: (snapshotId: string) => void }) {
	const [session, setSession] = useState<{ token: string; url: string; qrSvg: string; expiresAt: number } | null>(null);
	const [status, setStatus] = useState<string>("starting");
	const [error, setError] = useState<string | null>(null);
	const tokenRef = useRef<string | null>(null);
	const onPhotoRef = useRef(onPhoto);
	onPhotoRef.current = onPhoto;

	useEffect(() => {
		let stopped = false;
		const base = `/api/chats/${encodeURIComponent(chatId)}/phone-upload`;
		void (async () => {
			const res = await fetch(base, { method: "POST" }).catch(() => null);
			const body = (await res?.json().catch(() => null)) as { token?: string; url?: string; qrSvg?: string; expiresAt?: number; error?: string } | null;
			if (stopped) {
				// Closed before the link arrived: shut the listener now.
				if (body?.token) void fetch(`${base}?token=${body.token}`, { method: "DELETE" }).catch(() => {});
				return;
			}
			if (!res?.ok || !body?.token) {
				setError(body?.error ?? "Could not start the phone upload.");
				return;
			}
			tokenRef.current = body.token;
			setSession({ token: body.token, url: body.url!, qrSvg: body.qrSvg!, expiresAt: body.expiresAt! });
			setStatus("waiting");
			while (!stopped) {
				await new Promise((r) => setTimeout(r, 1500));
				if (stopped) return;
				const poll = await fetch(`${base}?token=${body.token}`).catch(() => null);
				const st = (await poll?.json().catch(() => null)) as { state?: string; snapshotId?: string; error?: string } | null;
				if (stopped || !st?.state) continue;
				setStatus(st.state);
				if (st.state === "done" && st.snapshotId) {
					tokenRef.current = null;
					onPhotoRef.current(st.snapshotId);
					return;
				}
				if (st.state === "failed" || st.state === "expired") {
					setError(st.error ?? (st.state === "expired" ? "The link expired. Close and try again." : "The photo could not be read."));
					tokenRef.current = null;
					return;
				}
			}
		})();
		return () => {
			stopped = true;
			if (tokenRef.current) void fetch(`${base}?token=${tokenRef.current}`, { method: "DELETE" }).catch(() => {});
		};
	}, [chatId]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div role="dialog" aria-label="Photo from phone" data-testid="phone-upload" className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
			<div className="w-80 max-w-full rounded-xl border bg-card p-4 text-sm shadow-xl">
				<div className="mb-2 flex items-center justify-between">
					<span className="font-medium">Photo from your phone</span>
					<button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
						<XIcon className="size-4" />
					</button>
				</div>
				{error ? (
					<p className="text-red-500">{error}</p>
				) : !session ? (
					<p className="flex items-center gap-2 text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Starting…</p>
				) : (
					<>
						{/* The SVG comes from our own server's QR encoder. */}
						<div className="mx-auto w-56 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: session.qrSvg }} />
						<ol className="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground">
							<li>Phone on the same Wi-Fi as this computer.</li>
							<li>Scan the code with the camera, open the link.</li>
							<li>Take or choose the photo. It appears here.</li>
						</ol>
						<p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
							{status === "received" ? <><Loader2Icon className="size-3.5 animate-spin" /> Got it — processing…</> : "Waiting for the photo… (one photo, link expires in 10 min)"}
						</p>
						<p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/60">{session.url}</p>
						<p className="mt-1 text-[11px] text-muted-foreground/70">First time: if Windows asks, allow LearnHarness on private networks.</p>
					</>
				)}
			</div>
		</div>
	);
}
