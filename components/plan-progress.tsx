"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarIcon, XIcon } from "lucide-react";
import { computePlanProgress, formatStudyTime, localDate, MIN_MEASURED_STEPS, type LhMessage, type PlanProgress, type PlanTarget, type PlanTree } from "@/src/core";
import { cn } from "@/lib/utils";

/**
 * Fork (2026-11-07): plan progress surfaces — the top-bar chip and the plan
 * view's header panel. Numbers come from core/plan-progress.ts; `now`
 * ticks once a minute so "time left" and the pace stay current.
 */

export function usePlanProgress(tree: PlanTree | null, messages: readonly LhMessage[], target: PlanTarget | null | undefined): PlanProgress | null {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(id);
	}, []);
	return useMemo(
		() => (tree && tree.nodes.length > 0 ? computePlanProgress({ tree, messages, target: target ?? null, now }) : null),
		[tree, messages, target, now],
	);
}

/** "15 Nov" (the learner's locale-neutral short date). */
export function shortDate(date: string): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function Bar({ percent, className }: { percent: number; className?: string }) {
	return (
		<span className={cn("relative block h-1.5 overflow-hidden rounded-full bg-muted-foreground/20", className)} aria-hidden>
			<span className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-[width]" style={{ width: `${percent}%` }} />
		</span>
	);
}

const PACE_LABEL: Record<NonNullable<PlanProgress["pace"]>, string> = {
	"on-track": "On track",
	behind: "Behind pace",
	past: "Target date passed",
	complete: "Plan complete",
};
const PACE_CLASS: Record<NonNullable<PlanProgress["pace"]>, string> = {
	"on-track": "text-emerald-500",
	behind: "text-amber-500",
	past: "text-red-500",
	complete: "text-emerald-500",
};

/** The top-bar chip's text after the bar: "6/15 · ~3 h left · 15 Nov". */
export function chipSummary(p: PlanProgress): string {
	const parts = [`${p.done}/${p.total}`];
	if (p.pace === "complete") parts.push("done");
	else if (p.remainingMs !== null) parts.push(`~${formatStudyTime(p.remainingMs)} left`);
	if (p.target && p.pace !== "complete") parts.push(shortDate(p.target.date));
	return parts.join(" · ");
}

export function PlanProgressChip({ progress }: { progress: PlanProgress }) {
	return (
		<span data-testid="plan-progress-chip" className="flex items-center gap-1.5 normal-case tracking-normal">
			<Bar percent={progress.percent} className="w-10" />
			<span className={cn(progress.pace === "behind" && "text-amber-500", progress.pace === "past" && "text-red-500")}>
				{chipSummary(progress)}
			</span>
		</span>
	);
}

/** The plan view's header panel: bar, counts, time, the target date control, pace. */
export function PlanProgressPanel({
	progress: p,
	inProgress,
	onSetTarget,
}: {
	progress: PlanProgress;
	/** Nodes started but not done (visited/current). */
	inProgress: number;
	onSetTarget?: (date: string | null) => Promise<boolean>;
}) {
	const [draft, setDraft] = useState(p.target?.date ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => setDraft(p.target?.date ?? ""), [p.target?.date]);
	const ahead = Math.max(0, p.total - p.done - inProgress);

	const save = async (date: string | null) => {
		if (!onSetTarget) return;
		setSaving(true);
		setError(null);
		const ok = await onSetTarget(date).catch(() => false);
		setSaving(false);
		if (!ok) setError("Could not save the date. Try again.");
	};

	return (
		<div data-testid="plan-progress-panel" className="mb-2 flex flex-col gap-2 rounded-xl border bg-card/70 px-3 py-2.5 text-xs">
			<div className="flex items-center gap-3">
				<span className="text-sm font-medium tabular-nums">{p.percent}%</span>
				<Bar percent={p.percent} className="flex-1" />
				<span className="text-muted-foreground tabular-nums">
					{p.done} done · {inProgress} in progress · {ahead} ahead
				</span>
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
				<span>Study time: <span className="text-foreground">{formatStudyTime(p.studyMs)}</span></span>
				<span>
					Time left:{" "}
					<span className="text-foreground" data-testid="plan-time-left">
						{p.pace === "complete" ? "none" : p.remainingMs !== null ? `~${formatStudyTime(p.remainingMs)}` : `after ${MIN_MEASURED_STEPS} measured steps (${p.measuredDone} so far)`}
					</span>
				</span>
				{p.target && p.daysLeft !== null && p.pace !== "past" && p.pace !== "complete" && (
					<span>
						{p.daysLeft} day{p.daysLeft === 1 ? "" : "s"} left
						{p.minutesPerDayNeeded !== null && <> · needs ~{Math.ceil(p.minutesPerDayNeeded)} min/day</>}
						{p.minutesPerDaySoFar !== null && <> · you average ~{Math.round(p.minutesPerDaySoFar)} min/day</>}
					</span>
				)}
				{p.pace && <span data-testid="plan-pace" className={cn("font-medium", PACE_CLASS[p.pace])}>{PACE_LABEL[p.pace]}</span>}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden />
				<label htmlFor="plan-target-date" className="text-muted-foreground">Target date</label>
				<input
					id="plan-target-date"
					data-testid="plan-target-date"
					type="date"
					value={draft}
					min={localDate(Date.now())}
					disabled={!onSetTarget || saving}
					onChange={(e) => setDraft(e.target.value)}
					className="rounded-md border border-border bg-transparent px-1.5 py-0.5 text-xs"
				/>
				{draft && draft !== (p.target?.date ?? "") && (
					<button
						type="button"
						data-testid="plan-target-save"
						disabled={saving}
						onClick={() => void save(draft)}
						className="rounded-md border border-border px-2 py-0.5 font-medium transition-colors hover:bg-accent disabled:opacity-50"
					>
						{saving ? "Saving…" : "Save"}
					</button>
				)}
				{p.target && (
					<button
						type="button"
						aria-label="Clear the target date"
						data-testid="plan-target-clear"
						disabled={saving}
						onClick={() => { setDraft(""); void save(null); }}
						className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<XIcon className="size-3.5" />
					</button>
				)}
				{p.target && <span className="text-muted-foreground/70">set by {p.target.setBy === "learner" ? "you" : "the teacher"}</span>}
				{error && <span className="text-red-500">{error}</span>}
			</div>
		</div>
	);
}
