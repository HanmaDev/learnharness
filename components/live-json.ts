"use client";
/**
 * Fork: fetch a JSON view and keep it current — refetch on the record-changed
 * push (optionally only for one chat), on reconnect, and on a slow timer.
 * Pushes are debounced so a streaming turn doesn't trigger a request storm.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";

export function useLiveJson<T>(url: string | null, opts: { chatId?: string; everyMs?: number; debounceMs?: number } = {}) {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const seq = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
	const soon = useCallback(() => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => void load(), opts.debounceMs ?? 600);
	}, [load, opts.debounceMs]);
	useEffect(() => {
		void load();
		const t = window.setInterval(() => void load(), opts.everyMs ?? 60_000);
		return () => {
			window.clearInterval(t);
			clearTimeout(timer.current);
		};
	}, [load, opts.everyMs]);
	useServerEvent("record-changed", ({ chatId }) => {
		if (!opts.chatId || chatId === opts.chatId) soon();
	});
	useServerResync(() => void load());
	return { data, setData, error, reload: load };
}
