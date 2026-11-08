"use client";
/**
 * Fork (problem log, 2026-11-08): pieces the Zadaci tabs share — the log
 * fetch, the action POST, the outcome pill, and the attempt / add dialog.
 */
import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { useLiveJson } from "@/components/live-json";
import { cn } from "@/lib/utils";
import { BRANCHES, OUTCOME_LABELS, OUTCOMES, localDate, resolveDate, type Outcome, type ProblemEntry, type ProblemLog } from "@/src/core";

export const BTN =
	"cursor-pointer rounded-md border border-border px-3 py-1.5 font-ui text-xs uppercase tracking-wider text-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-50";
export const INPUT = "h-9 rounded-md border border-border bg-background px-3 text-base text-foreground outline-none focus:border-amber-500!";

export function useProblemLog() {
	return useLiveJson<ProblemLog>("/api/problems", { chatId: "problems", debounceMs: 300 });
}

/** POST one action; returns the new log or throws with the server's message. */
export async function problemAction(body: Record<string, unknown>): Promise<ProblemLog> {
	const res = await fetch("/api/problems", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const json = (await res.json().catch(() => ({}))) as ProblemLog & { error?: string };
	if (!res.ok) throw new Error(json.error ?? `${res.status}`);
	return json;
}

const PILL: Record<Outcome, string> = {
	clean: "border-green-500/60! bg-green-500/10 text-green-300",
	slow: "border-green-500/60! bg-green-500/10 text-green-300",
	hint: "border-amber-500/60! bg-amber-500/10 text-amber-300",
	read: "border-red-500/60! bg-red-500/10 text-red-300",
	unsolved: "border-red-500/60! bg-red-500/10 text-red-300",
};

export function OutcomePill({ outcome, minutes }: { outcome: Outcome; minutes?: number }) {
	return (
		<span className={cn("inline-block whitespace-nowrap rounded-md border px-2 py-0.5 text-sm", PILL[outcome])} data-testid="outcome-pill">
			{OUTCOME_LABELS[outcome]}
			{minutes ? ` · ${minutes} min` : ""}
		</span>
	);
}

const dayDiff = (a: string, b: string) => {
	const p = (s: string) => {
		const [y, m, d] = s.split("-").map(Number) as [number, number, number];
		return Date.UTC(y, m - 1, d);
	};
	return Math.round((p(a) - p(b)) / 86_400_000);
};

/** "danas" / "kasni 3 dana" / "za 12 dana" / "—", and whether it is due. */
export function nextLabel(e: ProblemEntry, now: number): { text: string; due: boolean } {
	const d = resolveDate(e);
	if (!d) return { text: "—", due: false };
	const n = dayDiff(d, localDate(now));
	if (n === 0) return { text: "danas", due: true };
	if (n < 0) return { text: `kasni ${-n} ${-n === 1 ? "dan" : "dana"}`, due: true };
	return { text: `za ${n} ${n === 1 ? "dan" : "dana"}`, due: false };
}

export interface DialogSeed {
	/** Fixed problem (a re-attempt): source/reference aren't editable. */
	fixed?: boolean;
	category?: string;
	source?: string;
	reference?: string;
	branch?: string;
	trackerId?: string;
}

/** "+ Dodaj zadatak" and "+ Pokušaj": one attempt, for a new or known problem. */
export function AttemptDialog({ seed, log, onClose, onSaved }: { seed: DialogSeed; log: ProblemLog; onClose: () => void; onSaved: (log: ProblemLog) => void }) {
	const [source, setSource] = useState(seed.source ?? "");
	const [reference, setReference] = useState(seed.reference ?? "");
	const [category, setCategory] = useState(seed.category ?? "");
	const [branch, setBranch] = useState(seed.branch ?? "");
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const [minutes, setMinutes] = useState("");
	const [note, setNote] = useState("");
	const [date, setDate] = useState(localDate(Date.now()));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	const sources = [...new Set(log.entries.map((e) => e.source))].sort();
	const ok = source.trim() && reference.trim() && outcome && !busy;
	const save = async () => {
		if (!ok) return;
		setBusy(true);
		setError(null);
		try {
			const today = localDate(Date.now());
			const next = await problemAction({
				op: "attempt",
				input: {
					source: source.trim(),
					reference: reference.trim(),
					outcome,
					...(category ? { category } : {}),
					...(branch ? { branch } : {}),
					...(seed.trackerId ? { trackerId: seed.trackerId } : {}),
					...(minutes.trim() ? { minutes: Number(minutes) } : {}),
					...(note.trim() ? { note: note.trim() } : {}),
					...(date && date !== today ? { at: new Date(`${date}T12:00:00`).toISOString() } : {}),
				},
			});
			onSaved(next);
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setBusy(false);
		}
	};
	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="w-full max-w-xl rounded-lg border border-border bg-background p-6 font-prose shadow-2xl" role="dialog" aria-label="Pokušaj" data-testid="attempt-dialog">
				<div className="flex items-center">
					<h2 className="flex-1 font-title text-2xl">{seed.fixed ? "Novi pokušaj" : "Dodaj zadatak"}</h2>
					<button type="button" onClick={onClose} aria-label="Zatvori" className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground">
						<XIcon className="size-5" />
					</button>
				</div>
				{seed.fixed ? (
					<p className="mt-2 text-lg">
						{reference} <span className="text-muted-foreground">· {source}</span>
					</p>
				) : (
					<div className="mt-4 grid grid-cols-2 gap-3">
						<label className="col-span-2 flex flex-col gap-1 text-sm text-muted-foreground">
							Zadatak
							<input autoFocus value={reference} onChange={(e) => setReference(e.target.value)} placeholder="3.4 / 17, EGMO 4.12, …" className={INPUT} data-testid="field-reference" />
						</label>
						<label className="flex flex-col gap-1 text-sm text-muted-foreground">
							Izvor
							<input value={source} onChange={(e) => setSource(e.target.value)} list="problem-sources" placeholder="Thomas' Calculus" className={INPUT} data-testid="field-source" />
							<datalist id="problem-sources">
								{sources.map((s) => (
									<option key={s} value={s} />
								))}
							</datalist>
						</label>
						<label className="flex flex-col gap-1 text-sm text-muted-foreground">
							Kategorija
							<select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT}>
								<option value="">Automatski (po izvoru)</option>
								{log.categories.map((c) => (
									<option key={c.id} value={c.id}>
										{c.label}
									</option>
								))}
							</select>
						</label>
						<label className="col-span-2 flex flex-col gap-1 text-sm text-muted-foreground">
							Oblast
							<select value={branch} onChange={(e) => setBranch(e.target.value)} className={INPUT}>
								<option value="">—</option>
								{BRANCHES.map((b) => (
									<option key={b} value={b}>
										{b}
									</option>
								))}
							</select>
						</label>
					</div>
				)}
				<p className="mt-4 text-sm text-muted-foreground">Kako je prošlo?</p>
				<div className="mt-1 flex flex-wrap gap-2" role="radiogroup">
					{OUTCOMES.map((o) => (
						<button
							key={o}
							type="button"
							role="radio"
							aria-checked={outcome === o}
							data-testid={`outcome-${o}`}
							onClick={() => setOutcome(o)}
							className={cn("cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors", outcome === o ? PILL[o] : "border-border text-muted-foreground hover:text-foreground")}
						>
							{OUTCOME_LABELS[o]}
						</button>
					))}
				</div>
				<div className="mt-4 grid grid-cols-2 gap-3">
					<label className="flex flex-col gap-1 text-sm text-muted-foreground">
						Minuti
						<input value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="npr. 25" className={INPUT} data-testid="field-minutes" />
					</label>
					<label className="flex flex-col gap-1 text-sm text-muted-foreground">
						Datum
						<input type="date" value={date} max={localDate(Date.now())} onChange={(e) => setDate(e.target.value)} className={INPUT} />
					</label>
					<label className="col-span-2 flex flex-col gap-1 text-sm text-muted-foreground">
						Beleška
						<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ključna ideja ili gde je zapelo" className={INPUT} />
					</label>
				</div>
				{error && <p className="mt-3 text-sm text-red-400">{error}</p>}
				<div className="mt-5 flex justify-end gap-2">
					<button type="button" onClick={onClose} className={BTN}>
						Otkaži
					</button>
					<button type="button" onClick={() => void save()} disabled={!ok} className={cn(BTN, "border-amber-500! bg-amber-500 font-medium text-black hover:bg-amber-400")} data-testid="attempt-save">
						Sačuvaj
					</button>
				</div>
			</div>
		</div>
	);
}
