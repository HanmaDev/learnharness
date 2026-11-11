"use client";
/**
 * Fork (statistics): today / week / month / all-time totals, the last 30 days
 * and a year heat map with the streak (mockup docs/fork-plans/mockups/stats-v1.png).
 */
import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { useLiveJson } from "@/components/live-json";
import { cn } from "@/lib/utils";
import { localDate, type DayStats, type StatsView } from "@/src/core";

type Range = "today" | "week" | "month" | "all";
const RANGES: Array<[Range, string]> = [
	["today", "Danas"],
	["week", "Nedelja"],
	["month", "Mesec"],
	["all", "Ukupno"],
];
const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "avg", "sep", "okt", "nov", "dec"];

export function formatDuration(sec: number): string {
	const min = Math.round(sec / 60);
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	const m = min % 60;
	return m ? `${h} h ${m} min` : `${h} h`;
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const daysWord = (n: number) => (n === 1 ? "dan" : "dana");

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
	return (
		<div className="rounded-lg border border-border bg-white/[0.035] px-5 py-4" data-testid="stat-tile">
			<p className="font-ui text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
			<p className={cn("mt-1.5 text-3xl", accent ? "text-warning" : "text-foreground")}>{value}</p>
			{sub && <p className="mt-0.5 text-base text-muted-foreground">{sub}</p>}
		</div>
	);
}

export function StatsPage() {
	const [course, setCourse] = useState("");
	const [range, setRange] = useState<Range>("week");
	const { data, error } = useLiveJson<StatsView>(`/api/stats${course ? `?course=${encodeURIComponent(course)}` : ""}`, { debounceMs: 3_000 });
	const r: DayStats | undefined = data?.ranges[range];
	return (
		<div className="flex h-dvh min-w-0 flex-1 flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight">Statistika</h1>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto pb-16 font-prose">
				<div className="mx-auto w-full max-w-7xl px-8 pt-6">
					<div className="flex flex-wrap items-center gap-4">
						<div className="flex rounded-md border border-border p-0.5" role="tablist">
							{RANGES.map(([id, label]) => (
								<button
									key={id}
									type="button"
									role="tab"
									aria-selected={range === id}
									data-testid={`range-${id}`}
									onClick={() => setRange(id)}
									className={cn(
										"cursor-pointer rounded px-4 py-1.5 font-ui text-sm uppercase tracking-wider",
										range === id ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground",
									)}
								>
									{label}
								</button>
							))}
						</div>
						<span className="relative">
							<select
								value={course}
								onChange={(e) => setCourse(e.target.value)}
								aria-label="Kurs"
								className="h-9 cursor-pointer appearance-none rounded-md border border-border bg-background pr-8 pl-3 text-base text-foreground outline-none"
							>
								<option value="">Svi kursevi</option>
								{data?.courses.map((c) => (
									<option key={c.id} value={c.id}>
										{c.title.length > 50 ? `${c.title.slice(0, 48)}…` : c.title}
									</option>
								))}
							</select>
							<ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground" />
						</span>
					</div>

					{error && !data && <p className="mt-6 text-sm text-muted-foreground">Statistika ne može da se učita ({error}).</p>}
					{data && r && (
						<>
							<div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
								<Tile label="Vreme učenja" value={formatDuration(r.studySec)} />
								<Tile label="Koraci" value={String(r.steps)} sub="završeno" />
								<Tile label="Pitanja" value={String(r.questions)} sub={r.graded ? `${pct(r.correct, r.graded)} tačno` : undefined} />
								<Tile label="Kartice" value={String(r.reviews)} sub={r.reviews ? `${pct(r.recalled, r.reviews)} zapamćeno` : undefined} />
								<Tile label="Zadaci" value={String(r.problems)} sub={r.problems ? `${r.problemsAlone} sam` : undefined} />
								<Tile label="Niz" value={`${data.streaks.current} ${daysWord(data.streaks.current)}`} accent />
							</div>

							<DailyBars days={data.last30} />

							<YearGrid cells={data.year} />
							<p className="mt-4 text-lg text-foreground/85" data-testid="streak-summary">
								Trenutni niz: <b className="font-semibold text-warning">{data.streaks.current} {daysWord(data.streaks.current)}</b> · Najduži niz: {data.streaks.longest}{" "}
								{daysWord(data.streaks.longest)} · Ukupno: {data.streaks.activeDays} {daysWord(data.streaks.activeDays)} učenja
							</p>
							<p className="mt-2 text-sm text-muted-foreground">Vreme učenja se meri dok je prozor aktivan i nešto radiš (od 8. novembra 2026); ostalo je iz tvojih odgovora, koraka i kartica.</p>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function niceMax(n: number) {
	for (const step of [20, 40, 60, 120, 180, 240, 360, 480]) if (n <= step) return step;
	return Math.ceil(n / 120) * 120;
}

function DailyBars({ days }: { days: StatsView["last30"] }) {
	const mins = days.map((d) => Math.round(d.stats.studySec / 60));
	const max = niceMax(Math.max(20, ...mins));
	const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0].map((t) => Math.round(t));
	return (
		<div className="mt-8 rounded-lg border border-white/25! bg-white/[0.035] px-6 pt-5 pb-3" data-testid="daily-bars">
			<p className="mb-4 font-ui text-base uppercase tracking-widest text-foreground">Vreme učenja po danima · min</p>
			<div className="flex gap-3">
				<div className="relative h-44 w-10 shrink-0 font-ui text-xs text-muted-foreground">
					{ticks.map((t, i) => (
						<span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}>
							{t}
						</span>
					))}
				</div>
				<div className="relative min-w-0 flex-1">
					{ticks.map((_, i) => (
						<span key={i} className="pointer-events-none absolute inset-x-0 border-t border-white/15!" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} />
					))}
					<div className="relative flex h-44 items-end gap-1.5">
						{days.map((d, i) => {
							const s = d.stats;
							const tip = `${d.date}: ${mins[i]} min · ${s.questions} pitanja · ${s.reviews} kartica · ${s.steps} koraka`;
							const h = mins[i] === 0 ? (s.questions || s.reviews ? 2 : 0) : Math.max(2, (mins[i]! / max) * 100);
							return (
								<div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end" title={tip}>
									<div className={cn("w-full rounded-t-sm", i === days.length - 1 ? "bg-warning" : mins[i] === 0 ? "bg-success/30" : "bg-success")} style={{ height: `${h}%` }} />
								</div>
							);
						})}
					</div>
					<div className="mt-2 flex gap-1.5">
						{days.map((d, i) => (
							<span key={d.date} className="flex-1 text-center font-ui text-xs text-muted-foreground">
								{i % 2 === (days.length - 1) % 2 ? Number(d.date.slice(8)) : ""}
							</span>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

function shade(c: StatsView["year"][number]) {
	if (c.minutes >= 90) return "bg-success";
	if (c.minutes >= 45) return "bg-success/80";
	if (c.minutes >= 15) return "bg-success/60";
	if (c.minutes > 0 || c.active) return "bg-success/45";
	return "bg-white/15";
}

function YearGrid({ cells }: { cells: StatsView["year"] }) {
	const weeks: Array<typeof cells> = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	const today = localDate(Date.now());
	const cols = { gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` };
	return (
		<div className="mt-6 rounded-lg border border-white/25! bg-white/[0.035] px-6 py-5" data-testid="year-grid">
			<p className="mb-4 font-ui text-base uppercase tracking-widest text-foreground">Aktivnost tokom godine</p>
			<div className="grid gap-[3px]" style={cols}>
				{weeks.map((w, i) => {
					const first = w[0]!.date;
					const prev = weeks[i - 1]?.[0]?.date;
					const label = !prev || prev.slice(5, 7) !== first.slice(5, 7) ? MONTHS[Number(first.slice(5, 7)) - 1] : "";
					return (
						<span key={first} className="overflow-visible font-ui text-xs whitespace-nowrap text-muted-foreground">
							{label}
						</span>
					);
				})}
			</div>
			<div className="mt-1.5 grid gap-[3px]" style={cols}>
				{weeks.map((w) => (
					<div key={w[0]!.date} className="flex flex-col gap-[3px]">
						{w.map((c) => (
							<span
								key={c.date}
								title={`${c.date}: ${c.minutes} min`}
								className={cn("aspect-square w-full rounded-[2px]", shade(c), c.date === today && "ring-1 ring-primary")}
							/>
						))}
					</div>
				))}
			</div>
			<div className="mt-3 flex items-center justify-end gap-1.5 font-ui text-xs text-muted-foreground">
				Manje
				{["bg-white/15", "bg-success/45", "bg-success/60", "bg-success/80", "bg-success"].map((c) => (
					<span key={c} className={cn("size-[11px] rounded-[2px]", c)} />
				))}
				Više
			</div>
		</div>
	);
}
