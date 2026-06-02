// Tool-call rendering: details block per call, args summary, streaming partial
// output, final result. Interactive tools (ask_user, request_mode_switch,
// finalize_plan, todo_write) get pretty-formatted result blocks instead of the
// raw JSON envelope.

import { cssEscape, escapeHtml, md, safeStringify, summarizeArgs } from "./helpers";
import { highlightBlock, highlightLine, langFromPath } from "./syntax";
import { ensureBubble, pinStatusToEnd } from "./turn-lifecycle";
import { t } from "./i18n";

/** Tools whose primary UX is a question card. Pretty-render their result block. */
export const INTERACTIVE_TOOLS = new Set([
	"ask_user",
	"request_mode_switch",
	"finalize_plan",
	"todo_write",
]);

/** Pi built-in tools we render with a custom summary + result formatter.
 *  Skips the generic JSON args dump (summary alone conveys the key info). */
export const BUILT_IN_PRETTY = new Set([
	"bash",
	"edit",
	"write",
	"read",
	"grep",
	"find",
	"ls",
	"multi_edit",
]);

/** Collapse the details block after stream end if the result has more than
 *  this many lines. User can click to expand. Keeps the chat scrollable. */
const COLLAPSE_LINES_THRESHOLD = 10;

/** Build the `<details class="tool-call">` element used by BOTH live streaming
 *  (addToolCall) and history replay (renderAssistantHistory in history.ts).
 *  Keeping one builder stops the two from drifting (class tags, args-block
 *  gating, diff-body extraction must stay identical). `spinner` adds the
 *  running indicator — live only; history calls are already complete. */
export function buildToolCallBlock(
	toolName: string,
	toolCallId: string,
	args: unknown,
	opts: { spinner?: boolean } = {},
): HTMLDetailsElement {
	const block = document.createElement("details");
	block.className = "tool-call";
	if (INTERACTIVE_TOOLS.has(toolName)) block.classList.add("tool-call-interactive");
	if (BUILT_IN_PRETTY.has(toolName)) block.classList.add("tool-call-builtin");
	block.dataset.toolCallId = toolCallId;
	block.dataset.toolName = toolName;

	const summary = document.createElement("summary");
	summary.innerHTML =
		`<span class="tool-name">${escapeHtml(toolName)}</span>` +
		summaryHtmlForTool(toolName, args) +
		(opts.spinner ? `<span class="tool-spinner" title="${escapeHtml(t("tool.running"))}">⏳</span>` : "");
	block.appendChild(summary);

	// bash: the summary is a truncated one-liner. When the real command is
	// longer or multi-line, show it verbatim (wrapped) inside the expanded
	// block so the user can read the whole thing without leaving the chat.
	// Also Ctrl/Cmd-clickable to open in an editor (same as the summary).
	if (toolName === "bash") {
		const cmd = String((args as { command?: unknown })?.command ?? "").trim();
		if (cmd && (cmd.includes("\n") || cmd.length > 100)) {
			const pre = document.createElement("pre");
			pre.className = "tool-bash-cmd bash-cmd-link";
			pre.dataset.bashCmd = cmd;
			pre.title = "Ctrl/Cmd-click to open the full command in an editor";
			pre.textContent = cmd;
			block.appendChild(pre);
		}
	}

	// Args JSON block only when (a) not interactive (those use a card UI),
	// (b) not a known built-in (those have a clean summary), and (c) >1 key
	// worth showing. For typical { path } / { command } args the summary
	// already conveys everything; a JSON pre below would be pure noise.
	if (
		args !== undefined &&
		!INTERACTIVE_TOOLS.has(toolName) &&
		!BUILT_IN_PRETTY.has(toolName) &&
		shouldShowArgsBlock(args)
	) {
		const pre = document.createElement("pre");
		pre.className = "tool-input";
		pre.textContent = safeStringify(args);
		block.appendChild(pre);
	}

	// Edit/write/multi_edit: render a diff body up-front from args so the user
	// sees the change before tool execution finishes. Auto-open so the diff
	// is visible without an extra click.
	const diffBody = renderEditOrWriteBody(toolName, args);
	if (diffBody) {
		const wrap = document.createElement("div");
		wrap.innerHTML = diffBody;
		// Move the actual element (first child) out of the wrapper.
		const inner = wrap.firstElementChild;
		if (inner) block.appendChild(inner);
		block.open = true;
	}
	return block;
}

export function addToolCall(toolName: string, toolCallId: string, args: unknown): void {
	const b = ensureBubble();
	if (!b.toolsEl) {
		b.toolsEl = document.createElement("div");
		b.toolsEl.className = "msg-tools";
		b.bubble.appendChild(b.toolsEl);
	}
	b.toolsEl.appendChild(buildToolCallBlock(toolName, toolCallId, args, { spinner: true }));
	pinStatusToEnd();
}

/** Render a diff/preview body for edit/write/multi_edit from args.
 *  Returns "" if the tool doesn't qualify or args are missing.
 *
 *  Pi-side schemas (verified against pi-coding-agent core/tools/{edit,write}.js):
 *    edit:  { path: string, edits: [{ oldText: string, newText: string }, ...] }
 *    write: { path: string, content: string }
 *  Both prefer `path`; fall back to `file_path` for foreign-schema compatibility. */
export function renderEditOrWriteBody(toolName: string, args: any): string {
	if (toolName === "edit" || toolName === "multi_edit") {
		const path = String(args?.path ?? args?.file_path ?? "");
		// Pi's edit takes an array (oldText/newText). Some legacy single-edit
		// callers might send {old_string, new_string} directly — handle both.
		const edits = collectEdits(args);
		if (edits.length === 0) return "";
		// No path header here — the <summary> above already shows the path
		// (clickable file-link). Repeating it inside the body was just visual
		// noise. The edit count is still useful, surface it inline instead.
		const lang = langFromPath(path);
		const blocks = edits
			.map((e, i) => {
				const sep =
					edits.length > 1
						? `<div class="edit-diff-edit-sep">edit ${i + 1} / ${edits.length}</div>`
						: "";
				return (i > 0 ? sep : "") + renderDiffRows(e.oldText, e.newText, lang);
			})
			.join("");
		return `<div class="edit-diff">${blocks}</div>`;
	}
	if (toolName === "write") {
		const path = String(args?.path ?? args?.file_path ?? "");
		const content = String(args?.content ?? "");
		return renderWritePreview(path, content);
	}
	if (toolName === "finalize_plan") {
		return renderFinalizePlanPreview(args);
	}
	return "";
}

/** Render plan summary + body + steps + validation + docs INSIDE the
 *  finalize_plan tool call body so the user can read the full plan WHILE
 *  the 3-option dialog is still up. Without this, the user has to commit
 *  to "new session / current session / revise" blind, only seeing the
 *  truncated summary in the tool-call chip. */
function renderFinalizePlanPreview(args: any): string {
	const summary = String(args?.summary ?? "").trim();
	const body = String(args?.body ?? "").trim();
	const steps: string[] = Array.isArray(args?.steps) ? args.steps.map((s: any) => String(s ?? "")) : [];
	const validation: string[] = Array.isArray(args?.validation)
		? args.validation.map((s: any) => String(s ?? ""))
		: [];
	const docs: string[] = Array.isArray(args?.docs) ? args.docs.map((s: any) => String(s ?? "")) : [];
	const target = String(args?.target_mode ?? "code");

	if (!summary && !body && steps.length === 0 && validation.length === 0 && docs.length === 0) {
		return "";
	}

	const parts: string[] = [];
	if (summary) {
		parts.push(`<div class="plan-summary">${escapeHtml(summary)}</div>`);
	}
	if (body) {
		// Body is free markdown — render via marked (same as assistant bubbles)
		// so ### sub-headings, lists, code fences all show properly.
		parts.push(`<div class="plan-body">${md(body)}</div>`);
	}
	if (steps.length) {
		parts.push(
			`<div class="plan-section-label">Steps</div>` +
				`<ol class="plan-steps">${steps
					.map((s) => `<li>${escapeHtml(s)}</li>`)
					.join("")}</ol>`,
		);
	}
	if (validation.length) {
		parts.push(
			`<div class="plan-section-label">Validation</div>` +
				`<ul class="plan-checklist plan-validation">${validation
					.map((v) => `<li>${escapeHtml(v)}</li>`)
					.join("")}</ul>`,
		);
	}
	if (docs.length) {
		parts.push(
			`<div class="plan-section-label">Documentation</div>` +
				`<ul class="plan-checklist plan-docs">${docs
					.map((d) => `<li>${escapeHtml(d)}</li>`)
					.join("")}</ul>`,
		);
	}
	parts.push(
		`<div class="plan-target">${t("tool.planHandoff", { target: `<code>${escapeHtml(target)}</code>` })}</div>`,
	);
	return `<div class="plan-preview">${parts.join("")}</div>`;
}

/** Normalize edit/multi_edit args into a flat list of {oldText, newText}.
 *  Handles Pi's array schema and legacy single-edit/snake-case variants. */
function collectEdits(args: any): { oldText: string; newText: string }[] {
	const out: { oldText: string; newText: string }[] = [];
	if (Array.isArray(args?.edits)) {
		for (const e of args.edits) {
			if (!e || typeof e !== "object") continue;
			const oldText = String(e.oldText ?? e.old_string ?? e.oldStr ?? "");
			const newText = String(e.newText ?? e.new_string ?? e.newStr ?? "");
			if (oldText || newText) out.push({ oldText, newText });
		}
	}
	// Legacy / inline single-edit fields on the args itself.
	const oldText = String(args?.oldText ?? args?.old_string ?? "");
	const newText = String(args?.newText ?? args?.new_string ?? "");
	if (oldText || newText) out.push({ oldText, newText });
	return out;
}

function renderWritePreview(path: string, content: string): string {
	if (!content && !path) return "";
	// Path header omitted — the <summary> already shows it. Avoids duplicate
	// path lines between the collapsed summary and the open body.
	const lang = langFromPath(path);
	const lines = content.split("\n");
	const MAX = 30;
	const shown = lines.slice(0, MAX);
	const more =
		lines.length > MAX
			? `<div class="diff-more">… +${lines.length - MAX} more lines (${content.length.toLocaleString()} chars)</div>`
			: "";
	const rows = shown
		.map(
			(line) =>
				`<div class="diff-row diff-row-new"><span class="diff-prefix">+</span>${highlightLine(line, lang) || " "}</div>`,
		)
		.join("");
	return `<div class="edit-diff">${rows}${more}</div>`;
}

/** Build a unified-diff line view for an old→new edit. Single-line edits use
 *  inline word-diff; multi-line edits run an LCS so unchanged lines stay as
 *  context (white) and only true insertions/deletions are colored. Each line
 *  body is syntax-highlighted via Shiki when a language is supplied. */
function renderDiffRows(oldStr: string, newStr: string, lang?: string): string {
	const oldLines = oldStr.split("\n");
	const newLines = newStr.split("\n");

	// Inline word-diff path: small single-line edits look much better with the
	// changed substring highlighted instead of two full-width red/green bars.
	if (oldLines.length === 1 && newLines.length === 1) {
		const [oldH, newH] = inlineWordDiff(oldLines[0], newLines[0]);
		return (
			`<div class="diff-row diff-row-old"><span class="diff-prefix">-</span>${oldH}</div>` +
			`<div class="diff-row diff-row-new"><span class="diff-prefix">+</span>${newH}</div>`
		);
	}

	const ops = lcsDiffOps(oldLines, newLines);
	const rows: string[] = [];
	for (const op of ops) {
		const body = highlightLine(op.line, lang) || " ";
		if (op.kind === "ctx") {
			rows.push(`<div class="diff-row diff-row-ctx"><span class="diff-prefix"> </span>${body}</div>`);
		} else if (op.kind === "del") {
			rows.push(`<div class="diff-row diff-row-old"><span class="diff-prefix">-</span>${body}</div>`);
		} else {
			rows.push(`<div class="diff-row diff-row-new"><span class="diff-prefix">+</span>${body}</div>`);
		}
	}
	return rows.join("");
}

type DiffOp = { kind: "ctx" | "del" | "add"; line: string };

/** Line-level diff via LCS backtrack. O(n*m) time/space — fine for typical
 *  edits (< few hundred lines). For pathologically large blocks (> 50k cells)
 *  we bail to a naive remove-then-add so we never hang the webview. */
function lcsDiffOps(a: string[], b: string[]): DiffOp[] {
	const n = a.length;
	const m = b.length;
	if (n * m > 50_000) {
		return [
			...a.map<DiffOp>((l) => ({ kind: "del", line: l })),
			...b.map<DiffOp>((l) => ({ kind: "add", line: l })),
		];
	}
	// dp[i][j] = LCS length of a[i..] and b[j..]
	const dp = new Array<Uint32Array>(n + 1);
	for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			ops.push({ kind: "ctx", line: a[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({ kind: "del", line: a[i] });
			i++;
		} else {
			ops.push({ kind: "add", line: b[j] });
			j++;
		}
	}
	while (i < n) ops.push({ kind: "del", line: a[i++] });
	while (j < m) ops.push({ kind: "add", line: b[j++] });
	return ops;
}

/** Highlight the differing middle of two single-line strings. */
function inlineWordDiff(oldS: string, newS: string): [string, string] {
	// Common prefix
	let prefix = 0;
	const minLen = Math.min(oldS.length, newS.length);
	while (prefix < minLen && oldS[prefix] === newS[prefix]) prefix++;
	// Common suffix (don't overlap into the prefix region)
	let suffix = 0;
	const remOld = oldS.length - prefix;
	const remNew = newS.length - prefix;
	const minRem = Math.min(remOld, remNew);
	while (suffix < minRem && oldS[oldS.length - 1 - suffix] === newS[newS.length - 1 - suffix]) {
		suffix++;
	}
	const oldPre = escapeHtml(oldS.slice(0, prefix));
	const oldMid = escapeHtml(oldS.slice(prefix, oldS.length - suffix));
	const oldSuf = escapeHtml(oldS.slice(oldS.length - suffix));
	const newPre = escapeHtml(newS.slice(0, prefix));
	const newMid = escapeHtml(newS.slice(prefix, newS.length - suffix));
	const newSuf = escapeHtml(newS.slice(newS.length - suffix));
	const oldMark = oldMid ? `<mark class="diff-mark-old">${oldMid}</mark>` : "";
	const newMark = newMid ? `<mark class="diff-mark-new">${newMid}</mark>` : "";
	return [`${oldPre}${oldMark}${oldSuf}`, `${newPre}${newMark}${newSuf}`];
}

/** Cleanest one-line summary for a tool call, regardless of category. */
export function summaryForTool(toolName: string, args: any): string {
	if (INTERACTIVE_TOOLS.has(toolName)) {
		const s = interactiveSummaryArgs(toolName, args);
		if (s) return s;
	}
	if (BUILT_IN_PRETTY.has(toolName)) {
		const s = builtInSummaryArgs(toolName, args);
		if (s) return s;
	}
	return summarizeArgs(args);
}

/** Compact summary for Pi built-ins. Show only the semantically primary field. */
function builtInSummaryArgs(toolName: string, args: any): string {
	if (toolName === "bash") {
		const cmd = String(args?.command ?? "").trim();
		// Multi-line scripts: show the first non-empty line + a line-count hint.
		const lines = cmd.split("\n").filter((l) => l.trim());
		const firstLine = lines[0] ?? "";
		const truncated = firstLine.length > 100 ? firstLine.slice(0, 97) + "…" : firstLine;
		const more = lines.length > 1 ? `  (+${lines.length - 1} lines)` : "";
		return truncated + more;
	}
	if (toolName === "edit" || toolName === "write" || toolName === "multi_edit") {
		const path = String(args?.path ?? args?.file_path ?? "");
		// For edit, append an `(N edits)` hint when multiple replacements are queued.
		if ((toolName === "edit" || toolName === "multi_edit") && Array.isArray(args?.edits) && args.edits.length > 1) {
			return `${path}  (${args.edits.length} edits)`;
		}
		return path;
	}
	if (toolName === "read") {
		const path = String(args?.path ?? args?.file_path ?? "");
		const off = typeof args?.offset === "number" ? args.offset : undefined;
		const lim = typeof args?.limit === "number" ? args.limit : undefined;
		if (off !== undefined || lim !== undefined) {
			const start = off ?? 0;
			const end = lim !== undefined ? start + lim : "?";
			return `${path} [${start}-${end}]`;
		}
		return path;
	}
	if (toolName === "grep") {
		const pattern = String(args?.pattern ?? "");
		const path = args?.path ? `  · ${args.path}` : "";
		const tr = pattern.length > 60 ? pattern.slice(0, 57) + "…" : pattern;
		return tr + path;
	}
	if (toolName === "find" || toolName === "ls") {
		return String(args?.path ?? args?.glob ?? args?.pattern ?? "");
	}
	return "";
}

/** Extract the primary file path from a tool's args, if there is one.
 *  Used to make tool summaries Ctrl/Cmd-clickable (opens the file in editor).
 *  Returns undefined for tools whose args aren't path-shaped. */
function filePathFromArgs(toolName: string, args: any): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	if (
		toolName === "edit" ||
		toolName === "write" ||
		toolName === "multi_edit" ||
		toolName === "read"
	) {
		const p = String(args?.path ?? args?.file_path ?? "");
		return p || undefined;
	}
	return undefined;
}

/** Build a summary HTML chunk. When a file path is present we wrap the entire
 *  summary text in a `.file-link` span so Ctrl/Cmd-click can open the file —
 *  events.ts has the global capture handler. */
export function summaryHtmlForTool(toolName: string, args: any): string {
	const text = summaryForTool(toolName, args);
	if (!text) return "";
	const path = filePathFromArgs(toolName, args);
	if (path) {
		return `<span class="tool-args-inline file-link" data-file-path="${escapeHtml(path)}" title="Ctrl/Cmd-click to open in editor">${escapeHtml(text)}</span>`;
	}
	// bash: the summary only shows the truncated first line. When the real
	// command is longer or multi-line, carry the full text in a data attr so
	// Ctrl/Cmd-click can open it in a scratch editor tab (mirrors file-link).
	if (toolName === "bash") {
		const cmd = String(args?.command ?? "").trim();
		if (cmd && (cmd.includes("\n") || cmd.length > 100)) {
			return `<span class="tool-args-inline bash-cmd-link" data-bash-cmd="${escapeHtml(cmd)}" title="Ctrl/Cmd-click to open the full command in an editor">${escapeHtml(text)}</span>`;
		}
	}
	return `<span class="tool-args-inline">${escapeHtml(text)}</span>`;
}

/** Show the args JSON only if args have more than one field worth showing. */
export function shouldShowArgsBlock(args: unknown): boolean {
	if (!args || typeof args !== "object") return false;
	const keys = Object.keys(args as Record<string, unknown>);
	return keys.length > 1;
}

/** Compact one-line description for interactive tool args. */
function interactiveSummaryArgs(toolName: string, args: any): string {
	if (toolName === "ask_user" && Array.isArray(args?.questions)) {
		const topics = args.questions.map((q: any) => q?.topic).filter(Boolean);
		return topics.length ? topics.join(" / ") : t("tool.questions", { n: args.questions.length });
	}
	if (toolName === "request_mode_switch") {
		return `→ ${args?.target_mode ?? "?"}${args?.reason ? ` · ${String(args.reason).slice(0, 50)}` : ""}`;
	}
	if (toolName === "finalize_plan") {
		return String(args?.summary ?? "").slice(0, 60);
	}
	if (toolName === "todo_write" && Array.isArray(args?.todos)) {
		const todos = args.todos;
		const done = todos.filter((t: any) => t?.status === "completed").length;
		const inProg = todos.find((t: any) => t?.status === "in_progress");
		const label = inProg ? `· ${String(inProg.content ?? "").slice(0, 40)}` : "";
		return `${done}/${todos.length} ${label}`.trim();
	}
	return "";
}

/** Render incremental partial output for a running tool (e.g. streaming bash).
 * Skips interactive tools — they have a custom pretty renderer that should
 * always be the source of truth, not a raw partial dump. */
export function updateToolPartial(toolCallId: string, partial: unknown): void {
	const block = document.querySelector<HTMLElement>(
		`[data-tool-call-id="${cssEscape(toolCallId)}"]`,
	);
	if (!block) return;
	if (INTERACTIVE_TOOLS.has(block.dataset.toolName ?? "")) return;
	(block as HTMLDetailsElement).open = true;
	let pre = block.querySelector<HTMLPreElement>(".tool-result-streaming");
	if (!pre) {
		pre = document.createElement("pre");
		pre.className = "tool-result tool-result-streaming";
		block.appendChild(pre);
	}
	pre.textContent = extractToolText(partial);
}

export function updateToolResult(toolCallId: string, ok: boolean, output: unknown): void {
	const block = document.querySelector<HTMLElement>(
		`[data-tool-call-id="${cssEscape(toolCallId)}"]`,
	);
	if (!block) return;
	// Remove the running spinner from the summary.
	block.querySelector(".tool-spinner")?.remove();

	const toolName = block.dataset.toolName ?? "";

	// 1. Interactive-tool pretty renderer (ask_user / todo_write / etc.)
	const interactivePretty = formatInteractiveResult(toolName, output, ok);
	if (interactivePretty) {
		block.querySelector(".tool-result-streaming")?.remove();
		const div = document.createElement("div");
		div.className = ok
			? "tool-result tool-result-pretty"
			: "tool-result tool-result-pretty tool-result-err";
		div.innerHTML = interactivePretty;
		block.appendChild(div);
		(block as HTMLDetailsElement).open = true;
		return;
	}

	// 2. Built-in pretty renderer (edit/write success → single-line confirm).
	const builtinPretty = formatBuiltInResult(toolName, output, ok);
	if (builtinPretty) {
		block.querySelector(".tool-result-streaming")?.remove();
		const div = document.createElement("div");
		div.className = ok
			? "tool-result tool-result-pretty tool-result-builtin"
			: "tool-result tool-result-pretty tool-result-err";
		div.innerHTML = builtinPretty.html;
		block.appendChild(div);
		(block as HTMLDetailsElement).open = builtinPretty.open;
		if (builtinPretty.summaryHint) {
			appendSummaryHint(block, builtinPretty.summaryHint);
		}
		return;
	}

	// 3. Default: raw text in a pre. Strip the AgentToolResult envelope:
	// most tools return { content: [{type:"text", text}], details?: ... }.
	const text = extractToolText(output);
	const existing = block.querySelector<HTMLPreElement>(".tool-result-streaming");
	const pre = existing ?? document.createElement("pre");
	pre.className = ok ? "tool-result" : "tool-result tool-result-err";
	// Special path: read tool success → syntax highlight the file content via
	// Shiki. Path lives on the summary's file-link element (we added it for
	// Ctrl/Cmd-click). Falls back to plain textContent if no path, no
	// supported language, or Shiki not ready yet.
	let usedHighlight = false;
	if (ok && toolName === "read") {
		const link = block.querySelector(".file-link");
		const filePath = link?.getAttribute("data-file-path") ?? undefined;
		const lang = langFromPath(filePath);
		if (lang) {
			pre.innerHTML = highlightBlock(text, lang);
			usedHighlight = true;
		}
	}
	if (!usedHighlight) pre.textContent = text;
	if (!existing) block.appendChild(pre);
	const lineCount = text === "" ? 0 : text.split("\n").length;
	if (lineCount > 1) {
		appendSummaryHint(block, `${lineCount} lines`);
	}
	// Auto-collapse long output so the chat stays scrollable. Errors stay open
	// so the user sees the failure immediately.
	if (ok && lineCount > COLLAPSE_LINES_THRESHOLD) {
		(block as HTMLDetailsElement).open = false;
	}
}

function appendSummaryHint(block: HTMLElement, text: string): void {
	const summary = block.querySelector("summary");
	if (!summary) return;
	// Replace any existing hint to avoid duplication on re-renders.
	summary.querySelector(".tool-result-lines")?.remove();
	const hint = document.createElement("span");
	hint.className = "tool-result-lines";
	hint.textContent = text;
	summary.appendChild(hint);
}

/** Pretty-format for Pi built-in tool results. Returns null to fall through. */
function formatBuiltInResult(
	toolName: string,
	output: any,
	ok: boolean,
): { html: string; open: boolean; summaryHint?: string } | null {
	if (!BUILT_IN_PRETTY.has(toolName)) return null;
	const text = extractToolText(output);

	// Edit / write / multi_edit: success is a single-line confirmation.
	if (toolName === "edit" || toolName === "write" || toolName === "multi_edit") {
		if (!ok) {
			const msg = text || safeStringify(output);
			return {
				html: `<span class="builtin-err">✗ ${escapeHtml(msg.slice(0, 400))}</span>`,
				open: true,
			};
		}
		const firstLine = text.split("\n").find((l) => l.trim()) ?? t("tool.done");
		return {
			html: `<span class="builtin-ok">✓ ${escapeHtml(firstLine.slice(0, 200))}</span>`,
			open: true,
		};
	}

	// Bash / read / grep / find / ls: keep raw output, but add a clear ✗ marker
	// on failure and a "N lines" hint regardless.
	if (!ok) {
		const msg = text || safeStringify(output);
		return {
			html: `<span class="builtin-err">✗ ${escapeHtml(msg.slice(0, 1000))}</span>`,
			open: true,
		};
	}
	// Successful raw-output tools fall through to the default pre rendering
	// (path 3 above) which already adds line count + auto-collapses.
	return null;
}

/** Extract human-readable text from an AgentToolResult, or fall back to JSON.
 *  When the envelope is just `{content: []}` (common for the FIRST partial
 *  event of a streaming bash call before any stdout has arrived), return ""
 *  so the streaming pre stays empty instead of briefly flashing the raw
 *  `{"content":[]}` JSON. */
export function extractToolText(output: any): string {
	if (output == null) return "";
	if (typeof output === "string") return output;
	const content = output.content;
	if (Array.isArray(content)) {
		const parts = content
			.filter((p: any) => p && p.type === "text" && typeof p.text === "string")
			.map((p: any) => p.text);
		if (parts.length > 0) return parts.join("\n");
		// Content array present but empty / non-text-only → no human text yet.
		// Return "" rather than JSON-dumping the envelope.
		return "";
	}
	return safeStringify(output);
}

/** Pretty-format the result for interactive tools. Returns "" to fall through. */
export function formatInteractiveResult(toolName: string, output: any, ok: boolean): string {
	const details = output?.details ?? {};
	if (toolName === "ask_user") {
		if (details?.cancelled) return `<span class="status-text">${escapeHtml(t("tool.cancelled"))}</span>`;
		const answers: any[] = details?.answers ?? [];
		if (answers.length === 0) return `<span class="status-text">${escapeHtml(t("tool.noResponse"))}</span>`;
		return (
			`<ul class="qa-list">` +
			answers
				.map(
					(a) =>
						`<li><span class="qa-topic">${escapeHtml(String(a.topic ?? "?"))}</span>` +
						`<span class="qa-answer">${escapeHtml(String(a.selected ?? ""))}${a.wasOther ? ` <em class="qa-other">${escapeHtml(t("tool.custom"))}</em>` : ""}</span></li>`,
				)
				.join("") +
			`</ul>`
		);
	}
	if (toolName === "request_mode_switch") {
		if (details?.cancelled) return `<span class="status-text">${escapeHtml(t("tool.cancelled"))}</span>`;
		const accepted = details?.accepted;
		if (accepted === true) return `<span class="status-text">${escapeHtml(t("tool.switchAccepted", { to: String(details?.to ?? "?") }))}</span>`;
		if (accepted === false) return `<span class="status-text">${escapeHtml(t("tool.switchRejected"))}</span>`;
		return "";
	}
	if (toolName === "todo_write") {
		const todos: any[] = details?.todos ?? [];
		if (todos.length === 0) return `<span class="status-text">${escapeHtml(t("tool.empty"))}</span>`;
		const ICON: Record<string, string> = {
			pending: "☐",
			in_progress: "▶",
			completed: "☑",
			cancelled: "✕",
		};
		const done = todos.filter((t) => t.status === "completed").length;
		const items = todos
			.map((t) => {
				const icon = ICON[t.status] ?? "•";
				const cls = `todo-item todo-${t.status} todo-pri-${t.priority ?? "medium"}`;
				const pri = t.priority && t.priority !== "medium"
					? `<span class="todo-pri">${escapeHtml(t.priority)}</span>`
					: "";
				return `<li class="${cls}"><span class="todo-icon">${escapeHtml(icon)}</span><span class="todo-label">${escapeHtml(String(t.content ?? ""))}</span>${pri}</li>`;
			})
			.join("");
		return (
			`<div class="todo-header">${escapeHtml(t("tool.todoHeader", { done, total: todos.length }))}</div>` +
			`<ul class="todo-list">${items}</ul>`
		);
	}
	if (toolName === "finalize_plan") {
		const branch = details?.branch ?? "?";
		const path = details?.planPath ?? details?.path ?? "";
		const labels: Record<string, string> = {
			new_session_auto: t("tool.branch.newSession"),
			new_session_via_client: t("tool.branch.newSession"),
			new_session_pending: t("tool.branch.newSessionPending"),
			current_session: t("tool.branch.currentSession"),
			current_session_deferred: t("tool.branch.currentSessionDeferred"),
			current_session_headless: t("tool.branch.currentSessionHeadless"),
			revise: t("tool.branch.revise"),
			deferred: t("tool.branch.deferred"),
		};
		const label = labels[String(branch)] ?? String(branch);
		// Plan path → Ctrl/Cmd-clickable file-link, same mechanism as
		// edit/write/read tool paths. The plan file is already on disk by
		// the time finalize_plan returns (Pi side wrote it), so vscode.open
		// resolves immediately.
		const pathHtml = path
			? `<br><small><span class="file-link" data-file-path="${escapeHtml(path)}" title="Ctrl/Cmd-click to open plan file">${escapeHtml(path)}</span></small>`
			: "";
		return `<span class="status-text">${escapeHtml(label)}</span>${pathHtml}`;
	}
	if (!ok) {
		// Generic error formatting
		const msg = output?.content?.[0]?.text ?? safeStringify(output);
		return `<span class="status-text">${escapeHtml(String(msg).slice(0, 200))}</span>`;
	}
	return "";
}
