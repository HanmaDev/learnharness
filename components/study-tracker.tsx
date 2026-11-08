"use client";
/**
 * Fork (statistics): the active-study-time tracker. Counts time while the
 * window is visible and focused and the learner typed, clicked, scrolled or
 * moved the pointer in the last IDLE_CUTOFF_MS, and reports it every
 * HEARTBEAT_MS for the course of the current page. Renders nothing.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { chatIdFromPath, HEARTBEAT_MS, IDLE_CUTOFF_MS, localDate, MAX_HEARTBEAT_SECONDS } from "@/src/core";

export function StudyTracker() {
	const pathname = usePathname();
	const chatRef = useRef<string | null>(null);
	chatRef.current = chatIdFromPath(pathname);

	useEffect(() => {
		let lastInput = Date.now();
		let lastTick = Date.now();
		const onInput = () => {
			lastInput = Date.now();
		};
		const events = ["keydown", "pointerdown", "wheel", "scroll", "pointermove"] as const;
		for (const e of events) window.addEventListener(e, onInput, { passive: true, capture: true });

		const active = () => document.visibilityState === "visible" && document.hasFocus() && Date.now() - lastInput < IDLE_CUTOFF_MS;
		/** `leaving`: the window just lost focus/visibility — the stretch up to
		 *  now still counts if the learner was recently active. */
		const flush = (leaving = false) => {
			const now = Date.now();
			const elapsed = Math.min(MAX_HEARTBEAT_SECONDS, (now - lastTick) / 1000);
			lastTick = now;
			const counted = leaving ? now - lastInput < IDLE_CUTOFF_MS : active();
			if (!counted || elapsed < 1) return;
			void fetch("/api/study/heartbeat", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ date: localDate(now), seconds: Math.round(elapsed), chatId: chatRef.current }),
				keepalive: true,
			}).catch(() => {});
		};
		const timer = window.setInterval(() => flush(), HEARTBEAT_MS);
		// Leaving the window: count the part since the last tick, then restart.
		const onHide = () => {
			if (document.visibilityState === "hidden") flush(true);
			else lastTick = Date.now();
		};
		const onBlur = () => flush(true);
		const onFocus = () => {
			lastTick = Date.now();
			lastInput = Date.now();
		};
		document.addEventListener("visibilitychange", onHide);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focus", onFocus);
		return () => {
			window.clearInterval(timer);
			for (const e of events) window.removeEventListener(e, onInput, { capture: true });
			document.removeEventListener("visibilitychange", onHide);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focus", onFocus);
		};
	}, []);
	return null;
}
