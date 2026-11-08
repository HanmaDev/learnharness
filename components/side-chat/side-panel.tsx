"use client";
/**
 * Fork (side chats): the side-question panel docked on the right of a lesson
 * (mockup docs/fork-plans/mockups/sidechat-v1.png). Threads are answered by a
 * separate agent and never reach the teacher, Kartice or the notes unless the
 * learner clicks "Sačuvaj u beleške" / "Napravi karticu". Also: the "Pitaj sa
 * strane" button that appears over selected teacher text.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircleQuestionIcon, PlusIcon, XIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { BrailleSpinner } from "@/components/braille-spinner";
import { useLiveJson } from "@/components/live-json";
import { cn } from "@/lib/utils";
import type { SideThread } from "@/src/core";

export interface SideRequest {
	/** Increments on every new request so the same text can be asked twice. */
	n: number;
	text?: string;
	quote?: string;
}

async function post(chatId: string, body: object): Promise<{ ok?: boolean; threadId?: string; threads?: SideThread[]; error?: string }> {
	const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/side`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	return (await res.json().catch(() => ({}))) as { ok?: boolean; threadId?: string; threads?: SideThread[]; error?: string };
}

export function useSideThreads(chatId: string) {
	return useLiveJson<{ threads: SideThread[] }>(`/api/chats/${encodeURIComponent(chatId)}/side`, { chatId, debounceMs: 250 });
}

/** The header chip: opens the panel, shows how many threads are open. */
export function SideChip({ count, onClick, active }: { count: number; onClick: () => void; active: boolean }) {
	return (
		<button
			type="button"
			data-testid="side-chip"
			title="Pitanje sa strane (/btw)"
			onClick={onClick}
			className={cn(
				"lh-no-drag flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide transition-colors hover:border-border hover:text-foreground",
				active ? "bg-accent text-foreground" : "text-muted-foreground",
			)}
		>
			<MessageCircleQuestionIcon className="size-3.5 text-green-400" aria-hidden />
			Sa strane{count > 0 ? ` ${count}` : ""}
		</button>
	);
}

export function SidePanel({
	chatId,
	threads,
	setThreads,
	onClose,
	request,
}: {
	chatId: string;
	threads: SideThread[];
	setThreads: (t: SideThread[]) => void;
	onClose: () => void;
	request: SideRequest | null;
}) {
	const open = threads.filter((t) => !t.closed);
	const closed = threads.filter((t) => t.closed);
	const [activeId, setActiveId] = useState<string | null>(open.at(-1)?.id ?? null);
	const [draft, setDraft] = useState("");
	const [quote, setQuote] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const active = threads.find((t) => t.id === activeId && !t.closed) ?? null;

	const ask = useCallback(
		async (text: string, q: string | null, threadId: string | null) => {
			if (!text.trim()) return;
			setSending(true);
			setError(null);
			const r = await post(chatId, { op: "ask", text, ...(threadId ? { threadId } : {}), ...(q ? { quote: q } : {}) });
			setSending(false);
			if (r.error) {
				setError(r.error);
				return;
			}
			if (r.threads) setThreads(r.threads);
			if (r.threadId) setActiveId(r.threadId);
			setDraft("");
			setQuote(null);
		},
		[chatId, setThreads],
	);

	// A request from /btw (text → new thread at once) or a selection (quote → prefill).
	const seen = useRef(0);
	useEffect(() => {
		if (!request || request.n === seen.current) return;
		seen.current = request.n;
		if (request.text) void ask(request.text, request.quote ?? null, null);
		else if (request.quote) {
			setQuote(request.quote);
			setActiveId(null);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [request, ask]);

	useEffect(() => {
		listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
	}, [active?.messages.length, active?.messages.at(-1)?.pending]);

	const act = async (body: object) => {
		const r = await post(chatId, body);
		if (r.error) setError(r.error);
		else if (r.threads) setThreads(r.threads);
	};

	const busyThread = active?.messages.some((m) => m.pending) ?? false;
	return (
		<aside
			className="fixed top-15 right-0 bottom-0 z-30 flex w-[440px] max-w-[90vw] flex-col border-l border-border bg-background/95 font-prose shadow-2xl backdrop-blur"
			data-testid="side-panel"
			aria-label="Pitanje sa strane"
		>
			<div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
				<span className="shrink-0 font-ui text-xs uppercase tracking-widest text-muted-foreground">Pitanje sa strane</span>
				<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
					{open.map((t) => (
						<span key={t.id} className={cn("flex shrink-0 items-center rounded-md border text-xs", t.id === activeId ? "border-green-500/80! bg-green-500/10 text-foreground" : "border-border text-muted-foreground")}>
							<button type="button" onClick={() => setActiveId(t.id)} className="max-w-36 cursor-pointer truncate px-2 py-1">
								{t.title}
							</button>
							<button type="button" aria-label="Zatvori temu" onClick={() => void act({ op: "close", threadId: t.id })} className="cursor-pointer px-1 py-1 text-muted-foreground hover:text-foreground">
								<XIcon className="size-3" />
							</button>
						</span>
					))}
					<button
						type="button"
						aria-label="Novo pitanje"
						onClick={() => {
							setActiveId(null);
							requestAnimationFrame(() => inputRef.current?.focus());
						}}
						className="shrink-0 cursor-pointer rounded-md border border-border p-1 text-muted-foreground hover:text-foreground"
					>
						<PlusIcon className="size-3.5" />
					</button>
				</div>
				<button type="button" aria-label="Zatvori panel" onClick={onClose} className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground">
					<XIcon className="size-4" />
				</button>
			</div>
			<p className="border-b border-border/60 px-4 py-1.5 text-xs text-muted-foreground">Nastavnik ovo ne vidi · ne ulazi u kartice ni beleške dok ne sačuvaš</p>

			<div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-testid="side-thread">
				{!active && (
					<div className="text-sm text-muted-foreground">
						<p>Postavi pitanje koje nije deo lekcije — odgovor stiže ovde, a lekcija ide dalje.</p>
						<p className="mt-2">
							Savet: u glavnom polju napiši <code className="rounded bg-muted px-1">/btw pitanje</code>, ili označi tekst nastavnika i klikni „Pitaj sa strane”.
						</p>
						{closed.length > 0 && (
							<div className="mt-5">
								<p className="mb-1.5 font-ui text-xs uppercase tracking-widest">Zatvorene teme</p>
								<div className="flex flex-wrap gap-1.5">
									{closed.map((t) => (
										<button
											key={t.id}
											type="button"
											onClick={async () => {
												await act({ op: "reopen", threadId: t.id });
												setActiveId(t.id);
											}}
											className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-accent"
										>
											{t.title}
										</button>
									))}
								</div>
							</div>
						)}
					</div>
				)}
				{active?.messages.map((m) =>
					m.role === "user" ? (
						<div key={m.id} className="mb-4 ml-8 rounded-lg bg-white/[0.06] px-3 py-2 text-[15px] text-foreground">
							{m.quote && <p className="mb-1.5 border-l-2 border-green-500/60! pl-2 text-xs text-muted-foreground">„{m.quote.length > 220 ? `${m.quote.slice(0, 220)}…` : m.quote}”</p>}
							{m.text}
						</div>
					) : (
						<div key={m.id} className="mb-5">
							{m.pending ? (
								<p className="flex items-center gap-2 text-sm text-muted-foreground">
									<BrailleSpinner label="Odgovaram" /> Odgovaram…
								</p>
							) : m.error ? (
								<p className="text-sm text-red-400">Odgovor nije uspeo: {m.error}</p>
							) : (
								<>
									<ToolContentResponse className="lh-prose block">{m.text}</ToolContentResponse>
									<div className="mt-2 flex gap-2">
										<button
											type="button"
											disabled={m.savedToNotes}
											onClick={() => void act({ op: "save-notes", threadId: active.id, messageId: m.id })}
											className="cursor-pointer rounded-md border border-border px-2 py-1 font-ui text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:cursor-default disabled:text-green-400"
										>
											{m.savedToNotes ? "Sačuvano u beleške" : "Sačuvaj u beleške"}
										</button>
										<button
											type="button"
											disabled={!!m.cardId}
											onClick={() => void act({ op: "make-card", threadId: active.id, messageId: m.id })}
											className="cursor-pointer rounded-md border border-border px-2 py-1 font-ui text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:cursor-default disabled:text-green-400"
										>
											{m.cardId ? "Kartica napravljena" : "Napravi karticu"}
										</button>
									</div>
								</>
							)}
						</div>
					),
				)}
			</div>

			<div className="border-t border-border p-3">
				{error && <p className="mb-2 text-xs text-red-400">{error}</p>}
				{quote && !active && (
					<p className="mb-2 flex items-start gap-2 border-l-2 border-green-500/60! pl-2 text-xs text-muted-foreground">
						<span className="min-w-0 flex-1">„{quote.length > 220 ? `${quote.slice(0, 220)}…` : quote}”</span>
						<button type="button" aria-label="Ukloni citat" onClick={() => setQuote(null)} className="cursor-pointer">
							<XIcon className="size-3" />
						</button>
					</p>
				)}
				<div className="flex items-end gap-2">
					<textarea
						ref={inputRef}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								if (!sending && !busyThread) void ask(draft, active ? null : quote, active?.id ?? null);
							}
						}}
						rows={2}
						placeholder={active ? "Nastavi ovu temu…" : "Pitaj nešto sa strane…"}
						data-testid="side-input"
						className="min-h-[44px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground/40!"
					/>
					<button
						type="button"
						data-testid="side-send"
						disabled={sending || busyThread || !draft.trim()}
						onClick={() => void ask(draft, active ? null : quote, active?.id ?? null)}
						className="h-[44px] cursor-pointer rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Pošalji
					</button>
				</div>
			</div>
		</aside>
	);
}

/** "Pitaj sa strane" over selected teacher text (outside the side panel). */
export function SelectionAsk({ onAsk }: { onAsk: (quote: string) => void }) {
	const [pos, setPos] = useState<{ x: number; y: number; text: string } | null>(null);
	useEffect(() => {
		const onUp = () => {
			setTimeout(() => {
				const sel = window.getSelection();
				const text = sel?.toString().trim() ?? "";
				if (!sel || sel.rangeCount === 0 || text.length < 3 || text.length > 2_000) return setPos(null);
				const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
				if (!node?.closest(".lh-prose") || node.closest("[data-testid=side-panel]") || node.closest("textarea, input, [contenteditable=true]")) return setPos(null);
				const r = sel.getRangeAt(0).getBoundingClientRect();
				setPos({ x: Math.min(window.innerWidth - 170, r.right), y: Math.max(8, r.top - 40), text });
			}, 0);
		};
		const onDown = (e: MouseEvent) => {
			if (!(e.target as Element | null)?.closest?.("[data-testid=selection-ask]")) setPos(null);
		};
		document.addEventListener("mouseup", onUp);
		document.addEventListener("mousedown", onDown);
		return () => {
			document.removeEventListener("mouseup", onUp);
			document.removeEventListener("mousedown", onDown);
		};
	}, []);
	if (!pos) return null;
	return (
		<button
			type="button"
			data-testid="selection-ask"
			style={{ left: pos.x, top: pos.y }}
			onClick={() => {
				onAsk(pos.text);
				setPos(null);
				window.getSelection()?.removeAllRanges();
			}}
			className="fixed z-40 flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1.5 font-ui text-xs uppercase tracking-wider text-foreground shadow-lg hover:bg-accent"
		>
			<MessageCircleQuestionIcon className="size-3.5 text-green-400" /> Pitaj sa strane
		</button>
	);
}
