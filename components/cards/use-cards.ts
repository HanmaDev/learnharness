"use client";
/**
 * Kartice (fork, 2026-11-08): client access to the card API. The server
 * builds every view (src/server/cards.ts); these hooks fetch it, refetch on
 * the record-changed push and on reconnect, and post the learner's actions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import type { CardRating, CourseCardsView, CourseDeckSummary } from "@/src/core";

export type { CourseCardsView, CourseDeckSummary };
export interface CardsOverview {
	globalEnabled: boolean;
	settings: CourseCardsView["settings"];
	decks: CourseDeckSummary[];
}

export const CARDS_CHANGED = "lh:cards-changed";

/** Tell every card view in this window to refetch (after a settings save). */
export function notifyCardsChanged() {
	window.dispatchEvent(new Event(CARDS_CHANGED));
}

function useRefetching<T>(url: string | null, onlyChat?: string) {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const seq = useRef(0);
	const load = useCallback(async () => {
		if (!url) return;
		const n = ++seq.current;
		try {
			const res = await fetch(url, { cache: "no-store" });
			if (!res.ok) throw new Error(`${res.status}`);
			const json = (await res.json()) as T;
			if (n === seq.current) {
				setData(json);
				setError(null);
			}
		} catch (e) {
			if (n === seq.current) setError(e instanceof Error ? e.message : String(e));
		}
	}, [url]);
	useEffect(() => {
		void load();
		const onChanged = () => void load();
		window.addEventListener(CARDS_CHANGED, onChanged);
		// Due times pass while the view is open: refresh every minute.
		const timer = window.setInterval(() => void load(), 60_000);
		return () => {
			window.removeEventListener(CARDS_CHANGED, onChanged);
			window.clearInterval(timer);
		};
	}, [load]);
	useServerEvent("record-changed", ({ chatId }) => {
		if (!onlyChat || chatId === onlyChat) void load();
	});
	useServerResync(() => void load());
	return { data, setData, error, reload: load };
}

export function useCardsOverview() {
	return useRefetching<CardsOverview>("/api/cards");
}

export function useCourseCards(chatId: string) {
	const { data, setData, error, reload } = useRefetching<CourseCardsView>(`/api/chats/${encodeURIComponent(chatId)}/cards`, chatId);
	const post = useCallback(
		async (body: object): Promise<CourseCardsView | null> => {
			const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/cards`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) return null;
			const view = (await res.json()) as CourseCardsView;
			setData(view);
			notifyCardsChanged();
			return view;
		},
		[chatId, setData],
	);
	return {
		view: data,
		error,
		reload,
		review: (cardId: string, rating: CardRating, correct?: boolean) => post({ op: "review", cardId, rating, ...(correct !== undefined ? { correct } : {}) }),
		setFlags: (cardId: string, flags: { suspended?: boolean; known?: boolean; deleted?: boolean }) => post({ op: "flags", cardId, ...flags }),
		setEnabled: (enabled: boolean) => post({ op: "enabled", enabled }),
	};
}

/** Save the app-wide card settings (the "cards" settings section). */
export async function saveCardSettings(next: Partial<CourseCardsView["settings"]>): Promise<boolean> {
	const res = await fetch("/api/settings/cards", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(next),
	});
	if (res.ok) notifyCardsChanged();
	return res.ok;
}
