"use client";

import { useEffect, useRef } from "react";
import { KeyboardIcon } from "lucide-react";

/**
 * Fork (2026-11-07): a visual formula editor — MathLive's <math-field>.
 * Type like on paper: "/" makes a fraction, "^" a power, "sqrt" a root;
 * the on-screen math keyboard opens from the keyboard button (and on touch).
 * The value is LaTeX. MathLive loads lazily; fonts come from /vendor
 * (copied from node_modules/mathlive/fonts, MIT) so it works offline.
 */

type MathfieldLike = HTMLElement & { value: string; setValue?: (v: string) => void; focus: () => void };

let configured = false;
async function loadMathLive() {
	const ml = await import("mathlive");
	if (!configured) {
		configured = true;
		const MFE = ml.MathfieldElement as unknown as { fontsDirectory: string | null; soundsDirectory: string | null };
		MFE.fontsDirectory = "/vendor/mathlive/fonts";
		MFE.soundsDirectory = null;
	}
	return ml;
}

export function MathField({
	value,
	onChange,
	onEnter,
	ariaLabel,
	testId,
	placeholder,
}: {
	value: string;
	onChange: (latex: string) => void;
	onEnter?: () => void;
	ariaLabel: string;
	testId?: string;
	placeholder?: string;
}) {
	const host = useRef<HTMLDivElement>(null);
	const field = useRef<MathfieldLike | null>(null);
	const hooks = useRef({ onChange, onEnter });
	hooks.current = { onChange, onEnter };
	const initial = useRef(value);

	useEffect(() => {
		let disposed = false;
		void loadMathLive().then(() => {
			const parent = host.current;
			if (disposed || !parent) return;
			const el = document.createElement("math-field") as MathfieldLike;
			el.setAttribute("aria-label", ariaLabel);
			el.setAttribute("data-exercise-focus", "");
			el.setAttribute("math-virtual-keyboard-policy", "manual");
			if (placeholder) el.setAttribute("placeholder", placeholder);
			el.style.width = "100%";
			el.style.fontSize = "18px";
			el.style.background = "transparent";
			el.style.color = "inherit";
			el.style.border = "none";
			el.style.outline = "none";
			el.value = initial.current;
			el.addEventListener("input", () => hooks.current.onChange(el.value));
			el.addEventListener("keydown", (e) => {
				e.stopPropagation(); // math keys are never app shortcuts
				if (e.key === "Enter") {
					e.preventDefault();
					hooks.current.onEnter?.();
				}
			});
			parent.appendChild(el);
			field.current = el;
		});
		return () => {
			disposed = true;
			field.current?.remove();
			field.current = null;
		};
	}, [ariaLabel, placeholder]);

	useEffect(() => {
		const el = field.current;
		if (el && el.value !== value) el.value = value;
	}, [value]);

	return (
		<div className="flex items-center gap-1 rounded-lg border bg-muted/40 px-2 py-1 focus-within:border-primary/60" data-testid={testId}>
			<div ref={host} className="min-h-9 min-w-0 flex-1" />
			<button
				type="button"
				aria-label="Math keyboard"
				title="Show the math keyboard"
				onClick={() => {
					field.current?.focus();
					(window as unknown as { mathVirtualKeyboard?: { show: () => void; visible: boolean; hide: () => void } }).mathVirtualKeyboard?.show();
				}}
				className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<KeyboardIcon className="size-4" />
			</button>
		</div>
	);
}
