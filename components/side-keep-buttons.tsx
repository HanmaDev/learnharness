"use client";
/**
 * Fork (2026-11-11): "Sačuvaj u beleške" / "Napravi karticu" under a finished
 * side answer. Side conversations stay private; these are the only ways an
 * answer leaves the side companion (src/server/side-keep.ts).
 */
import { useState } from "react";
import type { SideChatMessage } from "@/src/core";

type Op = "notes" | "card";

export function SideKeepButtons({ chatId, threadId, message }: { chatId: string; threadId: string; message: SideChatMessage }) {
	const [done, setDone] = useState<Record<Op, boolean>>({ notes: !!message.savedToNotes, card: !!message.cardId });
	const [busy, setBusy] = useState<Op | null>(null);
	const [error, setError] = useState<string | null>(null);
	if (message.role !== "assistant" || message.error !== undefined || message.stopped || message.pending || !message.text.trim()) return null;
	const isDone = (op: Op) => done[op] || (op === "notes" ? !!message.savedToNotes : !!message.cardId);
	const keep = async (op: Op) => {
		if (busy || isDone(op)) return;
		setBusy(op);
		setError(null);
		try {
			const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/side-chats/${encodeURIComponent(threadId)}/keep`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ messageId: message.id, op }),
			});
			if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `${res.status}`);
			setDone((d) => ({ ...d, [op]: true }));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	};
	const btn = "cursor-pointer rounded border border-border px-2 py-0.5 font-ui text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-60";
	return (
		<div className="flex flex-wrap items-center gap-2" data-testid="side-keep">
			<button type="button" className={btn} disabled={isDone("notes") || busy !== null} onClick={() => void keep("notes")} data-testid="side-keep-notes">
				{isDone("notes") ? "Sačuvano u beleške" : busy === "notes" ? "Čuvam…" : "Sačuvaj u beleške"}
			</button>
			<button type="button" className={btn} disabled={isDone("card") || busy !== null} onClick={() => void keep("card")} data-testid="side-keep-card">
				{isDone("card") ? "Kartica napravljena" : busy === "card" ? "Pravim…" : "Napravi karticu"}
			</button>
			{error && <span role="alert" className="text-xs text-destructive">{error}</span>}
		</div>
	);
}
