"use client";

/**
 * Fork (2026-11-07): "is the learner's formula the same as the answer?"
 *
 * Both sides are LaTeX. MathLive's own converter turns each into plain math
 * text (the same converter for both, so they agree), mathjs parses that, and
 * equality is decided NUMERICALLY: constants compare by value; expressions
 * are evaluated at many random points of their variables. Equivalent forms
 * (2x·cos(x²) vs cos(x²)·2x, (x−1)(x+1) vs x²−1, ½ vs 0.5) count as equal.
 * Anything that won't parse, or can't be sampled (inequalities, sets,
 * proofs), is "undecided" — the teacher judges those.
 *
 * Both libraries load lazily, only when a math answer is checked.
 */
export type MathVerdict = "equal" | "different" | "undecided";

const KNOWN = new Set(["pi", "e", "i", "Infinity", "NaN", "true", "false"]);

async function libs() {
	const [ml, math] = await Promise.all([import("mathlive"), import("mathjs")]);
	return { toAscii: (latex: string) => ml.convertLatexToAsciiMath(latex), math };
}

/** LaTeX → a mathjs-friendly expression string. */
export function asciiForMathjs(ascii: string): string {
	return wrapFractions(ascii)
		.replace(/(?<![a-z])ln(?![a-z])/gi, "log") // natural log (also right after a digit: 2ln x)
		.replace(/·|⋅|×/g, "*")
		.replace(/−/g, "-")
		.replace(/(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|log|sqrt|exp|abs|arcsin|arccos|arctan)\s+\^\s*(\d+)\s*([a-z0-9.]+|\([^()]*\))/gi, "($1($3))^$2") // sin^2 x → (sin(x))^2
		.replace(/(sin|cos|tan|cot|sec|csc|log|exp|abs|arcsin|arccos|arctan)\s+([a-z0-9.]+)(?![a-z(])/gi, "$1($2)") // sin x → sin(x)
		.replace(/\barcsin\b/g, "asin")
		.replace(/\barccos\b/g, "acos")
		.replace(/\barctan\b/g, "atan")
		.replace(/\s+/g, " ")
		.trim();
}

/** MathLive writes fractions as "(a)/(b)"; mathjs binds implicit
 *  multiplication tighter than "/", so "(1)/(2)x" would read 1/(2x).
 *  Wrap each "(…)/(…)" in its own parentheses: "((1)/(2))x". */
export function wrapFractions(s: string): string {
	const opens: number[] = [];
	const closes: number[] = [];
	for (let i = 0; i + 2 < s.length; i++) {
		if (s[i] !== ")" || s[i + 1] !== "/" || s[i + 2] !== "(") continue;
		let depth = 0;
		let start = -1;
		for (let j = i; j >= 0; j--) {
			if (s[j] === ")") depth++;
			else if (s[j] === "(" && --depth === 0) {
				start = j;
				break;
			}
		}
		depth = 0;
		let end = -1;
		for (let j = i + 2; j < s.length; j++) {
			if (s[j] === "(") depth++;
			else if (s[j] === ")" && --depth === 0) {
				end = j;
				break;
			}
		}
		if (start >= 0 && end >= 0) {
			opens.push(start);
			closes.push(end);
		}
	}
	if (opens.length === 0) return s;
	let out = "";
	for (let i = 0; i < s.length; i++) {
		out += "(".repeat(opens.filter((o) => o === i).length) + s[i] + ")".repeat(closes.filter((c) => c === i).length);
	}
	return out;
}

function sample(): number {
	// Avoid 0 and integers (they hide differences like x vs x^2 at 0/1).
	return (Math.random() * 5 - 2.5) || 0.37;
}

export async function mathEquivalent(answerLatex: string, givenLatex: string, accepted: readonly string[] = []): Promise<MathVerdict> {
	if (!givenLatex.trim()) return "different";
	let toAscii: (l: string) => string;
	let math: typeof import("mathjs");
	try {
		({ toAscii, math } = await libs());
	} catch {
		return "undecided";
	}
	const verdicts: MathVerdict[] = [];
	for (const target of [answerLatex, ...accepted]) verdicts.push(compareOne(math, toAscii, target, givenLatex));
	if (verdicts.includes("equal")) return "equal";
	return verdicts.every((v) => v === "different") ? "different" : "undecided";
}

function compareOne(math: typeof import("mathjs"), toAscii: (l: string) => string, aLatex: string, bLatex: string): MathVerdict {
	// Relations and sets are not sampled — the teacher judges them.
	if (/[<>≤≥]|\\(le|ge|leq|geq|lt|gt|neq|in|subset|cup|cap)\b|\\{/.test(aLatex + bLatex)) return "undecided";
	let a, b;
	try {
		a = math.parse(asciiForMathjs(toAscii(aLatex)));
		b = math.parse(asciiForMathjs(toAscii(bLatex)));
	} catch {
		return "undecided";
	}
	const vars = new Set<string>();
	for (const node of [a, b]) {
		node.traverse((n, _path, parent) => {
			if ((n as { isSymbolNode?: boolean }).isSymbolNode) {
				const name = (n as unknown as { name: string }).name;
				const isFn = (parent as { isFunctionNode?: boolean } | null)?.isFunctionNode && (parent as unknown as { fn: unknown }).fn === n;
				if (!isFn && !KNOWN.has(name)) vars.add(name);
			}
		});
	}
	let fa: (scope: Record<string, number>) => unknown, fb: typeof fa;
	try {
		const ca = a.compile();
		const cb = b.compile();
		fa = (s) => ca.evaluate(s);
		fb = (s) => cb.evaluate(s);
	} catch {
		return "undecided";
	}
	const close = (x: number, y: number) => Math.abs(x - y) <= 1e-7 * Math.max(1, Math.abs(x), Math.abs(y));
	const num = (v: unknown): number | null => {
		if (typeof v === "number") return Number.isFinite(v) ? v : null;
		const c = v as { re?: number; im?: number } | null;
		if (c && typeof c.re === "number" && Math.abs(c.im ?? 0) < 1e-12) return Number.isFinite(c.re) ? c.re : null;
		return null;
	};
	let checked = 0;
	for (let attempt = 0; attempt < 40 && checked < 12; attempt++) {
		const scope: Record<string, number> = {};
		for (const v of vars) scope[v] = sample();
		let x: number | null, y: number | null;
		try {
			x = num(fa(scope));
			y = num(fb(scope));
		} catch {
			return "undecided";
		}
		if (x === null || y === null) {
			if (vars.size === 0) return "undecided";
			continue; // outside the domain here — try another point
		}
		if (!close(x, y)) return "different";
		checked++;
		if (vars.size === 0) return "equal";
	}
	return checked >= 5 ? "equal" : "undecided";
}
