// Pure stateless utilities: markdown, escaping, JSON, arg summarization.

import { marked } from "marked";

// Configure marked once at module load. async:false because streaming needs
// synchronous parse; gfm:true for tables/strikethrough; breaks:false so a
// single \n is NOT treated as <br> (lists/paragraphs stay tight).
marked.setOptions({ gfm: true, breaks: false, async: false });

export function md(s: string): string {
	try {
		return marked.parse(s) as string;
	} catch {
		return escapeHtml(s);
	}
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function cssEscape(s: string): string {
	return s.replace(/"/g, '\\"');
}

export function safeStringify(v: unknown): string {
	try {
		return typeof v === "string" ? v : JSON.stringify(v, null, 2);
	} catch {
		return String(v);
	}
}

/** Compact one-line summary of tool args for the details summary chip. */
export function summarizeArgs(args: unknown): string {
	if (args == null) return "";
	if (typeof args === "string") return args.length > 80 ? args.slice(0, 77) + "…" : args;
	if (typeof args !== "object") return String(args);
	const a = args as Record<string, unknown>;
	for (const key of ["file_path", "path", "command", "pattern", "query", "url", "message"]) {
		const v = a[key];
		if (typeof v === "string" && v) return v.length > 80 ? v.slice(0, 77) + "…" : v;
	}
	const json = safeStringify(args).replace(/\s+/g, " ");
	return json.length > 80 ? json.slice(0, 77) + "…" : json;
}

/** Strip "provider/" prefix from a model label. */
export function displayModel(v: string): string {
	const idx = v.indexOf("/");
	return idx >= 0 ? v.slice(idx + 1) : v;
}

/** Plan-handoff implementation prompt template (referencing the saved plan file). */
export function buildPlanExecutionBody(path: string, targetMode: string): string {
	const mode = (targetMode || "code").toUpperCase();
	return [
		`You are now in ${mode} mode (handoff from plan). You are no longer read-only — edit/write/bash are available.`,
		"",
		`A plan was saved at ${path}. Read it first, then call todo_write with one item per plan step. Work through them one-by-one, marking in_progress before starting each and completed immediately after finishing.`,
		"",
		"Do not re-plan, expand scope, refactor adjacent code, or add features the plan did not ask for.",
		"",
		'If the plan has a real gap (missing step, contradicts the code, wrong path), call request_mode_switch("plan", reason, summary) instead of improvising.',
	].join("\n");
}
