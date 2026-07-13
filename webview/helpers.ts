// Pure stateless utilities: markdown, escaping, JSON, arg summarization.

import DOMPurify from "dompurify";
import { marked } from "marked";

// Configure marked once at module load. async:false because streaming needs
// synchronous parse; gfm:true for tables/strikethrough; breaks:false so a
// single \n is NOT treated as <br> (lists/paragraphs stay tight).
marked.setOptions({ gfm: true, breaks: false, async: false });

// DOMPurify hardening on top of its safe defaults. DOMPurify already strips
// <script>, inline event handlers (onload/onclick/...), and javascript: URLs.
// We additionally forbid <iframe>/<object>/<embed>/<form>/<input>/<button>
// (no use case in chat markdown), block data:* attributes, and tighten the
// URI allowlist to a small set of safe schemes.
const PURIFY_CONFIG = {
	FORBID_TAGS: ["iframe", "object", "embed", "form", "input", "button"],
	FORBID_ATTR: ["formaction", "onfocus", "onblur", "onload", "onerror"],
	ALLOW_DATA_ATTR: false,
	ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|sms|ftp):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

export function md(s: string): string {
	try {
		const raw = marked.parse(s);
		// marked can return a Promise if async slips on; sanitizing a Promise
		// would stringify to "[object Promise]". Fall back to plain escaping.
		if (typeof raw !== "string") return escapeHtml(s);
		return DOMPurify.sanitize(raw, PURIFY_CONFIG);
	} catch {
		return escapeHtml(s);
	}
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Escape a string for use inside a double-quoted attribute selector value,
 *  e.g. `[data-tool-call-id="${cssEscape(id)}"]`. Escapes the backslash and
 *  the closing quote so an id carrying either can't break out of the selector. */
export function cssEscape(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
	// Debug mode strips edit/write (bash only); don't tell it those tools exist.
	const modeLine =
		mode === "DEBUG"
			? `You are now in DEBUG mode (handoff from plan). You have full bash/shell access for reproduction and investigation, but edit/write are disabled — diagnose per the plan, don't modify code.`
			: `You are now in ${mode} mode (handoff from plan). You are no longer read-only — edit/write/bash are available.`;
	const lines = [
		modeLine,
		"",
		`A plan was saved at ${path}. Read it first, then call todo_write with one item per plan step. Work through them one-by-one, marking in_progress before starting each and completed immediately after finishing.`,
		"",
		"Do not re-plan, expand scope, refactor adjacent code, or add features the plan did not ask for.",
		"",
		'If the plan has a real gap (missing step, contradicts the code, wrong path), call request_mode_switch("plan", reason, summary) instead of improvising.',
	];
	if (mode !== "DEBUG") {
		lines.push(
			"",
			"When every step is done and the final validation pass is green, call finalize_implementation — it writes the implementation report and hands the work to review.",
		);
	}
	return lines.join("\n");
}

/** Review-handoff prompt template (referencing the saved implementation report).
 *  `sameSession` = reviewing in the implementing session itself (no parent plan
 *  session recorded) vs. in the parent plan session after a switch back. */
export function buildReviewBody(reportPath: string, sameSession: boolean): string {
	const opening = sameSession
		? "You are now in REVIEW mode. Review the implementation completed in this session against its plan."
		: "You are now in REVIEW mode. The implementation session launched from your plan has completed and handed back for review.";
	const planLine = sameSession
		? "The plan is in this session's context; if compaction removed it, re-read the plan file referenced in the report header."
		: "The plan you finalized earlier in this session is the review baseline. It should still be in context; if compaction removed it, re-read the plan file referenced in the report header.";
	return [
		opening,
		"",
		`Implementation report: ${reportPath} — read it first.`,
		planLine,
		"",
		"Follow the review protocol: verify the changed files against the plan's steps and pinned seam contracts, run every entry in the plan's Validation section, and check for scope creep. End with PASS or a numbered findings list (file:line evidence, severity: blocker / should-fix / nit), then stop — do not fix anything.",
		"",
		'If fixes are needed, the user will say so — then call finalize_plan with the fix-list as steps (target_mode "code") to launch the next implementation round.',
	].join("\n");
}
