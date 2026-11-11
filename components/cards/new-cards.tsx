"use client";
/**
 * Kartice (fork): "Nova pitanja" — pick a step (or the weakest steps) and a
 * count, the AI writes drafts, the learner keeps the ones they want.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { BrailleSpinner } from "@/components/braille-spinner";
import { cn } from "@/lib/utils";
import type { CardDraft } from "@/src/core";
import { notifyCardsChanged, type CourseCardsView } from "./use-cards";

export function NewCardsDialog({ chatId, view, onClose }: { chatId: string; view: CourseCardsView; onClose: () => void }) {
	const steps = useMemo(() => view.steps.map((s) => [s.id, s.title] as const), [view.steps]);
	const [nodeId, setNodeId] = useState("weak");
	const [count, setCount] = useState(5);
	const [phase, setPhase] = useState<"pick" | "working" | "review" | "saving">("pick");
	const [error, setError] = useState<string | null>(null);
	const [drafts, setDrafts] = useState<CardDraft[]>([]);
	const [keep, setKeep] = useState<Set<number>>(new Set());

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && phase !== "working" && phase !== "saving") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose, phase]);

	const generate = async () => {
		setPhase("working");
		setError(null);
		const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/cards/generate`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ nodeId, count }),
		}).catch(() => null);
		const json = (await res?.json().catch(() => null)) as { drafts?: CardDraft[]; error?: string } | null;
		if (!res?.ok || !json?.drafts) {
			setError(json?.error ?? "Pravljenje pitanja nije uspelo.");
			setPhase("pick");
			return;
		}
		setDrafts(json.drafts);
		setKeep(new Set(json.drafts.map((_, i) => i)));
		setPhase("review");
	};

	const save = async () => {
		const kept = drafts.filter((_, i) => keep.has(i));
		if (kept.length === 0) return onClose();
		setPhase("saving");
		const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/cards`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ op: "add", drafts: kept }),
		}).catch(() => null);
		if (!res?.ok) {
			setError("Čuvanje nije uspelo.");
			setPhase("review");
			return;
		}
		notifyCardsChanged();
		onClose();
	};

	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={(e) => e.target === e.currentTarget && phase === "pick" && onClose()}>
			<div role="dialog" aria-label="Nova pitanja" className="flex max-h-[85dvh] w-full max-w-3xl flex-col rounded-lg border border-border bg-background font-prose shadow-xl" data-testid="new-cards-dialog">
				<div className="flex items-center justify-between border-b border-border px-6 py-4">
					<p className="font-ui text-sm uppercase tracking-widest text-foreground">Nova pitanja</p>
					<button type="button" aria-label="Zatvori" onClick={onClose} disabled={phase === "working" || phase === "saving"} className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40">
						<XIcon className="size-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					{(phase === "pick" || phase === "working") && (
						<div className="flex flex-col gap-4">
							<label className="flex flex-col gap-1.5 text-sm">
								<span className="font-ui text-xs uppercase tracking-widest text-muted-foreground">Korak</span>
								<select value={nodeId} onChange={(e) => setNodeId(e.target.value)} disabled={phase === "working"} className="h-9 rounded-md border border-border bg-background px-2 text-foreground">
									<option value="weak">Slabi koraci (najviše promašaja)</option>
									{steps.map(([id, title]) => (
										<option key={id} value={id}>
											{title}
										</option>
									))}
								</select>
							</label>
							<label className="flex flex-col gap-1.5 text-sm">
								<span className="font-ui text-xs uppercase tracking-widest text-muted-foreground">Koliko</span>
								<select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={phase === "working"} className="h-9 w-24 rounded-md border border-border bg-background px-2 text-foreground">
									{[3, 5, 8, 10].map((n) => (
										<option key={n} value={n}>
											{n}
										</option>
									))}
								</select>
							</label>
							{error && <p className="text-sm text-error">{error}</p>}
							<p className="text-xs text-muted-foreground">Pitanja pravi isti model kao nastavnik. Prvo ih pregledaš, pa tek onda ulaze u špil.</p>
						</div>
					)}
					{(phase === "review" || phase === "saving") && (
						<div className="flex flex-col gap-3">
							{drafts.map((d, i) => (
								<label key={i} className={cn("flex cursor-pointer gap-3 rounded-md border p-3", keep.has(i) ? "border-emerald-500/60!" : "border-border opacity-60")}>
									<input
										type="checkbox"
										checked={keep.has(i)}
										onChange={() => setKeep((k) => { const n = new Set(k); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
										className="mt-1"
									/>
									<span className="min-w-0 flex-1">
										<span className="font-ui text-[11px] uppercase tracking-wider text-muted-foreground">
											{d.tool === "quiz" ? "Zaokruživanje" : "Slobodan odgovor"} · {steps.find(([id]) => id === d.nodeId)?.[1] ?? d.nodeId}
										</span>
										<ToolContentResponse className="lh-prose block text-sm">{String(d.args.question)}</ToolContentResponse>
									</span>
								</label>
							))}
							{error && <p className="text-sm text-error">{error}</p>}
						</div>
					)}
				</div>
				<div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
					{phase === "pick" && (
						<button type="button" data-testid="generate-cards" onClick={() => void generate()} className="cursor-pointer rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
							Napravi pitanja
						</button>
					)}
					{phase === "working" && (
						<span className="flex items-center gap-2 text-sm text-muted-foreground">
							<BrailleSpinner label="Pravim pitanja" /> Pravim pitanja…
						</span>
					)}
					{(phase === "review" || phase === "saving") && (
						<>
							<button type="button" onClick={() => setPhase("pick")} disabled={phase === "saving"} className="cursor-pointer rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
								Nazad
							</button>
							<button type="button" data-testid="save-cards" onClick={() => void save()} disabled={phase === "saving"} className="cursor-pointer rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60">
								Dodaj {keep.size} u špil
							</button>
						</>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
