"use client";
/**
 * Fork (problem log, 2026-11-08): the Zadaci page — a category switch, the
 * counts, and three tabs: Za ponovno rešavanje, Sve, Arhiva (the read-only
 * Matematika Tracker archive). Mockups: docs/fork-plans/mockups/zadaci-v1.png,
 * arhiva-v1.png. Plan: docs/fork-plans/problem-log-plan.md.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { MoreHorizontalIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import {
	BRANCHES,
	OUTCOME_LABELS,
	OUTCOMES,
	filterProblems,
	lastAttempt,
	problemCounts,
	resolveDate,
	type ChatListItem,
	type Outcome,
	type ProblemEntry,
	type ProblemLog,
} from "@/src/core";
import { ArchiveTab } from "./archive-tab";
import { AttemptDialog, BTN, INPUT, OutcomePill, nextLabel, problemAction, useProblemLog, type DialogSeed } from "./shared";

type Tab = "due" | "all" | "archive";
const TABS: Array<[Tab, string]> = [
	["due", "Za ponovno rešavanje"],
	["all", "Sve"],
	["archive", "Arhiva"],
];
const TAB_KEY = "lh:problems-tab";
const CAT_KEY = "lh:problems-category";

function Tile({ label, value, tone }: { label: string; value: string; tone?: "amber" | "green" }) {
	return (
		<div className="rounded-lg border border-border bg-white/[0.035] px-5 py-4" data-testid="problem-tile">
			<p className="font-ui text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
			<p className={cn("mt-1.5 text-3xl tabular-nums", tone === "amber" ? "text-amber-400" : tone === "green" ? "text-green-400" : "text-foreground")}>{value}</p>
		</div>
	);
}

export function ProblemsPage() {
	const { data: log, setData: setLog, error } = useProblemLog();
	const [tab, setTab] = useState<Tab>("due");
	const [category, setCategory] = useState("");
	const [dialog, setDialog] = useState<DialogSeed | null>(null);
	const [chats, setChats] = useState<ChatListItem[]>([]);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		try {
			const t = window.localStorage.getItem(TAB_KEY);
			if (t === "due" || t === "all" || t === "archive") setTab(t);
			setCategory(window.localStorage.getItem(CAT_KEY) ?? "");
		} catch {
			/* storage off */
		}
		fetch("/api/chats", { cache: "no-store" })
			.then((r) => r.json())
			.then((d: { chats: ChatListItem[] }) => setChats(d.chats))
			.catch(() => {});
		const t = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(t);
	}, []);
	const pick = <T extends string>(key: string, set: (v: T) => void) => (v: T) => {
		set(v);
		try {
			window.localStorage.setItem(key, v);
		} catch {
			/* storage off */
		}
	};
	const pickTab = pick<Tab>(TAB_KEY, setTab);
	const pickCategory = pick<string>(CAT_KEY, setCategory);
	// A deleted category falls back to "Sve".
	const activeCategory = log && category && log.categories.some((c) => c.id === category) ? category : "";
	const entries = useMemo(() => (log ? filterProblems(log.entries, { category: activeCategory || undefined }) : []), [log, activeCategory]);
	const counts = problemCounts(entries, now);
	const pct = counts.alone + counts.helped ? Math.round((counts.alone / (counts.alone + counts.helped)) * 100) : null;
	const run = async (body: Record<string, unknown>) => {
		try {
			setLog(await problemAction(body));
			return true;
		} catch (e) {
			window.alert(e instanceof Error ? e.message : String(e));
			return false;
		}
	};

	return (
		<div className="flex h-dvh min-w-0 flex-1 flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight">Zadaci</h1>
				<button type="button" onClick={() => setDialog({ category: activeCategory || undefined })} disabled={!log} className={cn(BTN, "flex items-center gap-1.5")} data-testid="add-problem">
					<PlusIcon className="size-3.5" />
					Dodaj zadatak
				</button>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto pb-16 font-prose">
				<div className="mx-auto w-full max-w-7xl px-8 pt-6">
					{error && !log && <p className="text-sm text-muted-foreground">Zadaci ne mogu da se učitaju ({error}).</p>}
					{log && (
						<>
							<CategoryBar log={log} active={activeCategory} onPick={pickCategory} run={run} chats={chats} />
							<div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
								<Tile label="Za danas" value={String(counts.due)} tone="amber" />
								<Tile label="Ukupno" value={String(counts.total)} />
								<Tile label="Sam rešio" value={pct === null ? String(counts.alone) : `${counts.alone} · ${pct}%`} tone="green" />
								<Tile label="Uz pomoć" value={String(counts.helped)} />
							</div>
							<div className="mt-6 flex gap-8 border-b border-border" role="tablist">
								{TABS.map(([id, label]) => (
									<button
										key={id}
										type="button"
										role="tab"
										aria-selected={tab === id}
										data-testid={`tab-${id}`}
										onClick={() => pickTab(id)}
										className={cn(
											"-mb-px cursor-pointer border-b-2 px-1 pb-2.5 font-ui text-sm uppercase tracking-widest transition-colors",
											tab === id ? "border-green-500! font-semibold text-foreground" : "border-transparent! text-muted-foreground hover:text-foreground",
										)}
									>
										{label}
									</button>
								))}
							</div>
							{tab === "due" && <DueTab entries={entries} log={log} now={now} run={run} onAttempt={setDialog} />}
							{tab === "all" && <AllTab entries={entries} log={log} now={now} run={run} onAttempt={setDialog} chats={chats} />}
							{tab === "archive" && <ArchiveTab log={log} now={now} onAttempt={setDialog} />}
						</>
					)}
				</div>
			</div>
			{dialog && log && <AttemptDialog seed={dialog} log={log} onClose={() => setDialog(null)} onSaved={setLog} />}
		</div>
	);
}

type Run = (body: Record<string, unknown>) => Promise<boolean>;

function CategoryBar({ log, active, onPick, run, chats }: { log: ProblemLog; active: string; onPick: (id: string) => void; run: Run; chats: ChatListItem[] }) {
	const [adding, setAdding] = useState(false);
	const [label, setLabel] = useState("");
	const [menu, setMenu] = useState(false);
	const all: Array<{ id: string; label: string }> = [{ id: "", label: "Sve" }, ...log.categories];
	const add = async () => {
		const l = label.trim();
		if (!l) return setAdding(false);
		if (await run({ op: "add-category", label: l })) {
			setLabel("");
			setAdding(false);
		}
	};
	return (
		<div>
			<div className="flex flex-wrap items-center gap-3">
				<div className="flex min-w-0 flex-1 flex-wrap divide-x divide-border overflow-hidden rounded-md border border-border" role="tablist" aria-label="Kategorija">
					{all.map((c) => (
						<button
							key={c.id || "all"}
							type="button"
							role="tab"
							aria-selected={active === c.id}
							data-testid={`category-${c.id || "all"}`}
							onClick={() => {
								onPick(c.id);
								setMenu(false);
							}}
							className={cn(
								"flex-auto cursor-pointer px-5 py-2 font-ui text-sm uppercase tracking-wider",
								active === c.id ? "bg-amber-500 font-medium text-black" : "text-muted-foreground hover:text-foreground",
							)}
						>
							{c.label}
						</button>
					))}
				</div>
				{active && (
					<button type="button" onClick={() => setMenu((m) => !m)} aria-label="Podešavanja kategorije" className={cn(BTN, "px-2")} data-testid="category-menu">
						<MoreHorizontalIcon className="size-4" />
					</button>
				)}
				{adding ? (
					<span className="flex items-center gap-2">
						<input
							autoFocus
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") void add();
								if (e.key === "Escape") setAdding(false);
							}}
							placeholder="Naziv kategorije"
							className={cn(INPUT, "w-56")}
							data-testid="category-label"
						/>
						<button type="button" onClick={() => void add()} className={BTN}>
							Dodaj
						</button>
					</span>
				) : (
					<button type="button" onClick={() => setAdding(true)} className={cn(BTN, "flex items-center gap-1.5")} data-testid="add-category">
						<PlusIcon className="size-3.5" />
						Kategorija
					</button>
				)}
			</div>
			{menu && active && <CategoryMenu key={active} log={log} id={active} run={run} chats={chats} onClose={() => setMenu(false)} />}
		</div>
	);
}

function CategoryMenu({ log, id, run, chats, onClose }: { log: ProblemLog; id: string; run: Run; chats: ChatListItem[]; onClose: () => void }) {
	const cat = log.categories.find((c) => c.id === id)!;
	const [label, setLabel] = useState(cat.label);
	const others = log.categories.filter((c) => c.id !== id);
	const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");
	const n = log.entries.filter((e) => e.category === id).length;
	const courses = chats;
	return (
		<div className="mt-3 rounded-lg border border-border bg-white/[0.035] p-4 text-base" data-testid="category-panel">
			<div className="flex flex-wrap items-center gap-2">
				<span className="w-40 text-sm text-muted-foreground">Naziv</span>
				<input value={label} onChange={(e) => setLabel(e.target.value)} className={cn(INPUT, "w-72")} />
				<button type="button" disabled={!label.trim() || label.trim() === cat.label} onClick={() => void run({ op: "rename-category", categoryId: id, label: label.trim() })} className={BTN}>
					Preimenuj
				</button>
				<button type="button" onClick={onClose} aria-label="Zatvori" className="ml-auto cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground">
					<XIcon className="size-4" />
				</button>
			</div>
			{others.length > 0 && (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<span className="w-40 text-sm text-muted-foreground">Obriši kategoriju</span>
					<span className="text-sm text-muted-foreground">{n} zadataka prebaci u</span>
					<select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={INPUT}>
						{others.map((c) => (
							<option key={c.id} value={c.id}>
								{c.label}
							</option>
						))}
					</select>
					<button
						type="button"
						onClick={() => {
							if (window.confirm(`Obrisati kategoriju „${cat.label}"? Njeni zadaci (${n}) prelaze u „${others.find((o) => o.id === moveTo)?.label}".`))
								void run({ op: "delete-category", categoryId: id, moveTo });
						}}
						className={cn(BTN, "border-red-500/60! text-red-300")}
					>
						Obriši
					</button>
				</div>
			)}
			{courses.length > 0 && (
				<div className="mt-3 flex flex-wrap items-start gap-2">
					<span className="w-40 pt-1 text-sm text-muted-foreground">Podrazumevana za kurseve</span>
					<div className="flex max-w-3xl flex-wrap gap-x-5 gap-y-1">
						{courses.map((c) => (
							<label key={c.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
								<input
									type="checkbox"
									className="accent-amber-500"
									checked={log.courseCategory[c.id] === id}
									onChange={(e) => void run({ op: "course-category", chatId: c.id, categoryId: e.target.checked ? id : null })}
								/>
								{c.title.length > 40 ? `${c.title.slice(0, 38)}…` : c.title}
							</label>
						))}
					</div>
				</div>
			)}
			<p className="mt-3 text-sm text-muted-foreground">Zadaci koje nastavnik zabeleži u tim kursevima idu u ovu kategoriju (ako ne navede drugu).</p>
		</div>
	);
}

interface TableProps {
	entries: ProblemEntry[];
	log: ProblemLog;
	now: number;
	run: Run;
	onAttempt: (seed: DialogSeed) => void;
}

function DueTab(p: TableProps) {
	const scheduled = p.entries
		.map((e) => ({ e, d: resolveDate(e) }))
		.filter((x): x is { e: ProblemEntry; d: string } => x.d !== null)
		.sort((a, b) => a.d.localeCompare(b.d))
		.map((x) => x.e);
	if (!scheduled.length)
		return (
			<p className="mt-8 text-lg text-muted-foreground" data-testid="due-empty">
				{p.entries.length ? "Ništa nije zakazano za ponovno rešavanje." : "Još nema zadataka. Dodaj ih ovde ili reci nastavniku šta si rešio — on ih beleži."}
			</p>
		);
	return <ProblemTable {...p} entries={scheduled} />;
}

function AllTab(p: TableProps & { chats: ChatListItem[] }) {
	const [source, setSource] = useState("");
	const [branch, setBranch] = useState("");
	const [outcome, setOutcome] = useState<Outcome | "">("");
	const [course, setCourse] = useState("");
	const [q, setQ] = useState("");
	const sources = [...new Set(p.entries.map((e) => e.source))].sort();
	const courseIds = new Set(p.entries.flatMap((e) => [e.chatId, ...e.attempts.map((a) => a.chatId)]).filter(Boolean));
	const courses = p.chats.filter((c) => courseIds.has(c.id));
	const list = filterProblems(p.entries, { source: source || undefined, branch: branch || undefined, outcome: outcome || undefined, q }).filter(
		(e) => !course || e.chatId === course || e.attempts.some((a) => a.chatId === course),
	);
	const sorted = [...list].sort((a, b) => (lastAttempt(b)?.at ?? b.createdAt).localeCompare(lastAttempt(a)?.at ?? a.createdAt));
	const sel = (label: string, value: string, set: (v: string) => void, options: Array<[string, string]>) => (
		<select value={value} onChange={(e) => set(e.target.value)} aria-label={label} className={INPUT}>
			<option value="">{label}: sve</option>
			{options.map(([v, l]) => (
				<option key={v} value={v}>
					{l}
				</option>
			))}
		</select>
	);
	return (
		<>
			<div className="mt-5 flex flex-wrap items-center gap-3">
				{sel("Izvor", source, setSource, sources.map((s) => [s, s]))}
				{sel("Oblast", branch, setBranch, BRANCHES.map((b) => [b, b]))}
				{sel("Ishod", outcome, (v) => setOutcome(v as Outcome | ""), OUTCOMES.map((o) => [o, OUTCOME_LABELS[o]]))}
				{courses.length > 0 && sel("Kurs", course, setCourse, courses.map((c) => [c.id, c.title.length > 40 ? `${c.title.slice(0, 38)}…` : c.title]))}
				<span className="relative min-w-56 flex-1">
					<SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pretraži…" className={cn(INPUT, "w-full pl-9")} data-testid="problems-search" />
				</span>
			</div>
			{sorted.length ? (
				<ProblemTable {...p} entries={sorted} />
			) : (
				<p className="mt-8 text-lg text-muted-foreground">{p.entries.length ? "Nijedan zadatak ne odgovara filterima." : "Još nema zadataka."}</p>
			)}
		</>
	);
}

function ProblemTable({ entries, log, now, run, onAttempt }: TableProps) {
	const [open, setOpen] = useState<string | null>(null);
	return (
		<div className="mt-5 overflow-x-auto rounded-lg border border-border">
			<table className="w-full text-left text-base" data-testid="problem-table">
				<thead>
					<tr className="border-b border-border font-ui text-xs uppercase tracking-widest text-muted-foreground">
						<th className="px-4 py-3 font-normal">Zadatak</th>
						<th className="px-4 py-3 font-normal">Izvor</th>
						<th className="px-4 py-3 font-normal">Oblast</th>
						<th className="px-4 py-3 font-normal">Poslednji pokušaj</th>
						<th className="px-4 py-3 font-normal">Sledeće</th>
						<th className="px-4 py-3 font-normal">Pokušaji</th>
						<th className="px-4 py-3" />
					</tr>
				</thead>
				<tbody>
					{entries.map((e) => {
						const last = lastAttempt(e);
						const next = nextLabel(e, now);
						return (
							<Fragment key={e.id}>
								<tr className="border-b border-border last:border-b-0" data-testid="problem-row">
									<td className="px-4 py-3" title={e.note}>
										{e.reference}
									</td>
									<td className="px-4 py-3">{e.source}</td>
									<td className="px-4 py-3">{e.branch ?? <span className="text-muted-foreground">—</span>}</td>
									<td className="px-4 py-3">{last ? <OutcomePill outcome={last.outcome} minutes={last.minutes} /> : <span className="text-muted-foreground">—</span>}</td>
									<td className={cn("whitespace-nowrap px-4 py-3", next.due ? "text-amber-400" : "text-foreground/85")}>{next.text}</td>
									<td className="px-4 py-3 tabular-nums">{e.attempts.length}</td>
									<td className="whitespace-nowrap px-4 py-3 text-right">
										<button
											type="button"
											onClick={() => onAttempt({ fixed: true, source: e.source, reference: e.reference, trackerId: e.trackerId })}
											className={cn(BTN, "mr-2")}
											data-testid="row-attempt"
										>
											+ Pokušaj
										</button>
										<button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} aria-label="Detalji" aria-expanded={open === e.id} className={cn(BTN, "px-2")} data-testid="row-menu">
											<MoreHorizontalIcon className="size-4" />
										</button>
									</td>
								</tr>
								{open === e.id && (
									<tr className="border-b border-border bg-white/[0.025] last:border-b-0">
										<td colSpan={7} className="px-4 py-4">
											<EntryEditor key={e.id} entry={e} log={log} run={run} onClose={() => setOpen(null)} />
										</td>
									</tr>
								)}
							</Fragment>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

const fmtTime = (iso: string) => {
	const d = new Date(iso);
	return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}.`;
};

function EntryEditor({ entry, log, run, onClose }: { entry: ProblemEntry; log: ProblemLog; run: Run; onClose: () => void }) {
	const [reference, setReference] = useState(entry.reference);
	const [source, setSource] = useState(entry.source);
	const [category, setCategory] = useState(entry.category);
	const [branch, setBranch] = useState(entry.branch ?? "");
	const [note, setNote] = useState(entry.note ?? "");
	const scheduled = resolveDate(entry) ?? "";
	const [date, setDate] = useState(scheduled);
	// The field follows the schedule when it changes underneath (a new
	// attempt, "Automatski"); a pick the learner hasn't applied yet is replaced.
	useEffect(() => setDate(scheduled), [scheduled]);
	const orphan = !log.categories.some((c) => c.id === entry.category);
	const dirty = reference !== entry.reference || source !== entry.source || category !== entry.category || branch !== (entry.branch ?? "") || note !== (entry.note ?? "");
	const save = () =>
		void run({
			op: "update",
			id: entry.id,
			...(reference.trim() && reference !== entry.reference ? { reference: reference.trim() } : {}),
			...(source.trim() && source !== entry.source ? { source: source.trim() } : {}),
			...(category !== entry.category ? { category } : {}),
			...(branch !== (entry.branch ?? "") ? { branch: branch || null } : {}),
			...(note !== (entry.note ?? "") ? { note: note.trim() || null } : {}),
		});
	const attempts = [...entry.attempts].sort((a, b) => b.at.localeCompare(a.at));
	return (
		<div className="grid gap-6 lg:grid-cols-2" data-testid="entry-editor">
			<div className="flex flex-col gap-3">
				<div className="grid grid-cols-2 gap-3">
					<label className="col-span-2 flex flex-col gap-1 text-sm text-muted-foreground">
						Zadatak
						<input value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} />
					</label>
					<label className="flex flex-col gap-1 text-sm text-muted-foreground">
						Izvor
						<input value={source} onChange={(e) => setSource(e.target.value)} className={INPUT} />
					</label>
					<label className="flex flex-col gap-1 text-sm text-muted-foreground">
						Kategorija
						<select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT}>
							{orphan && <option value={entry.category}>(obrisana kategorija)</option>}
							{log.categories.map((c) => (
								<option key={c.id} value={c.id}>
									{c.label}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1 text-sm text-muted-foreground">
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
					<label className="flex flex-col gap-1 text-sm text-muted-foreground">
						Beleška
						<input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
					</label>
				</div>
				<div className="flex gap-2">
					<button type="button" disabled={!dirty} onClick={save} className={BTN} data-testid="entry-save">
						Sačuvaj izmene
					</button>
					<button
						type="button"
						onClick={() => {
							if (window.confirm(`Obrisati zadatak „${entry.reference}" i svih ${entry.attempts.length} pokušaja?`)) void run({ op: "delete", id: entry.id }).then((ok) => ok && onClose());
						}}
						className={cn(BTN, "border-red-500/60! text-red-300")}
					>
						Obriši zadatak
					</button>
				</div>
				<div className="mt-2">
					<p className="text-sm text-muted-foreground">
						Ponovo rešavaj{" "}
						{entry.resolveOn === undefined ? "(automatski, po poslednjem ishodu)" : entry.resolveOn === null ? "(isključeno ručno)" : "(datum postavljen ručno)"}
					</p>
					<div className="mt-1 flex flex-wrap items-center gap-2">
						<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} data-testid="schedule-date" />
						<button type="button" disabled={!date || date === resolveDate(entry)} onClick={() => void run({ op: "schedule", id: entry.id, on: date })} className={BTN}>
							Postavi datum
						</button>
						<button
							type="button"
							disabled={entry.resolveOn === null}
							onClick={() => void run({ op: "schedule", id: entry.id, on: null }).then((ok) => ok && setDate(""))}
							className={BTN}
						>
							Bez ponavljanja
						</button>
						<button type="button" disabled={entry.resolveOn === undefined} onClick={() => void run({ op: "schedule", id: entry.id, on: "auto" })} className={BTN}>
							Automatski
						</button>
					</div>
				</div>
			</div>
			<div>
				<p className="text-sm text-muted-foreground">Pokušaji</p>
				<ul className="mt-1 flex flex-col gap-2">
					{attempts.map((a) => (
						<li key={a.id} className="flex items-start gap-3">
							<span className="w-28 shrink-0 pt-0.5 text-sm text-muted-foreground tabular-nums">{fmtTime(a.at)}</span>
							<span className="flex-1">
								<OutcomePill outcome={a.outcome} minutes={a.minutes} />
								{a.note && <span className="ml-2 text-foreground/85">{a.note}</span>}
								{a.chatId && <span className="ml-2 text-xs text-muted-foreground">(nastavnik)</span>}
							</span>
							<button
								type="button"
								aria-label="Obriši pokušaj"
								onClick={() => {
									if (window.confirm("Obrisati ovaj pokušaj?")) void run({ op: "delete-attempt", id: entry.id, attemptId: a.id });
								}}
								className="cursor-pointer rounded p-1 text-muted-foreground hover:text-red-300"
							>
								<XIcon className="size-4" />
							</button>
						</li>
					))}
					{!attempts.length && <li className="text-muted-foreground">Nema pokušaja.</li>}
				</ul>
			</div>
		</div>
	);
}
