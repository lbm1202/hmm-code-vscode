// Conversation history rendering: replay past messages from get_messages and
// build the "recent sessions" list on the empty state.

import { appendBubble, appendCompactionSummary, appendUserBubble, els, forceScrollToBottom, setEmptyVisibility } from "./dom";
import { md } from "./helpers";
import { t } from "./i18n";
import { showModal } from "./modals";
import { FROM_WEBVIEW } from "./protocol";
import { pendingUiRequests, post, runtime, todoPanelEnabled, ui } from "./state";
import { resetTodoPanel, updateTodoPanel } from "./todo-panel";
import { buildToolCallBlock, updateToolResult } from "./tools";
import { finalizeTurn } from "./turn-lifecycle";

/** Clear all messages and re-render any pending UI requests. */
export function clearConversation(): void {
	// A session change (start/switch/load) invalidates any in-flight compaction
	// from the previous session: clear the lock + its 240s safety timer here so
	// the new session's input isn't stuck disabled and the timer can't fire into
	// the wrong session. (finalizeTurn → updateSendButton → updatePromptDisabled
	// below then re-evaluates input with compacting=false.)
	if (runtime.compactTimeout != null) {
		clearTimeout(runtime.compactTimeout);
		runtime.compactTimeout = null;
	}
	runtime.compacting = false;
	finalizeTurn();
	els().messages.innerHTML = "";
	resetTodoPanel();
	setEmptyVisibility();
	// Re-render any UI requests we were waiting on. The Pi-side awaits are
	// still pending under the same ids, so reply correlation still works.
	for (const req of pendingUiRequests.values()) {
		showModal(req);
	}
}

// ── Lazy history windowing ───────────────────────────────────────────────────
// The full transcript can be hundreds–thousands of messages; rendering them all
// up front is heavy. Show the most recent window, then prepend older chunks on
// demand via a "load earlier" button at the top. Prepend is INCREMENTAL (never
// clears) so a live streaming turn isn't wiped, and window boundaries snap to a
// user message (turn start) so a toolCall and its toolResult never land in
// different chunks (which would orphan the result).
const INITIAL_WINDOW = 60; // messages rendered on first load
const WINDOW_CHUNK = 60; // additional messages per "load earlier" click
let historyBuffer: any[] = [];
let windowStart = 0;

/** Nearest user-message index at or before `idx` (a clean turn boundary). */
function snapToTurnStart(idx: number): number {
	for (let i = Math.min(idx, historyBuffer.length - 1); i >= 0; i--) {
		if (historyBuffer[i]?.role === "user") return i;
	}
	return 0;
}

function renderOneMessage(m: any): void {
	if (!m || typeof m !== "object") return;
	const role = m.role;
	if (role === "user") {
		const text = extractText(m.content);
		const images = extractImages(m.content);
		if (text || images.length) appendUserBubble(text, images);
	} else if (role === "assistant") {
		renderAssistantHistory(m);
	} else if (role === "toolResult") {
		// Pass full message-as-result so formatInteractiveResult can read
		// details.todos / details.answers etc. and pretty-render.
		updateToolResult(String(m.toolCallId ?? "?"), !m.isError, { content: m.content, details: m.details });
	} else if (role === "compactionSummary") {
		// Pi keeps the compaction summary as a message; replay it as the same
		// collapsed block the runtime compaction_end shows (survives reload/switch).
		appendCompactionSummary(typeof m.summary === "string" ? m.summary : "");
	}
	// other roles (custom, etc) — skip for V0
}

/** The "↑ load earlier messages" affordance at the top of the list. */
function makeLoadMoreButton(): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.className = "load-more-history";
	btn.textContent = t("chat.loadMoreHistory", { n: String(windowStart) });
	btn.addEventListener("click", loadEarlier);
	return btn;
}

function loadEarlier(): void {
	if (windowStart <= 0) return;
	const box = els().messages;
	const oldH = box.scrollHeight;
	const oldT = box.scrollTop;
	const prev = windowStart;
	const newStart = prev > WINDOW_CHUNK ? snapToTurnStart(prev - WINDOW_CHUNK) : 0;
	// Drop the current button, snapshot existing nodes, render the older chunk
	// (appends at the bottom), then move those new nodes to the front.
	box.querySelector(".load-more-history")?.remove();
	const before = new Set(Array.from(box.childNodes));
	const anchor = box.firstChild;
	for (let i = newStart; i < prev; i++) renderOneMessage(historyBuffer[i]);
	const added = Array.from(box.childNodes).filter((n) => !before.has(n));
	for (const n of added) box.insertBefore(n, anchor);
	windowStart = newStart;
	if (windowStart > 0) box.insertBefore(makeLoadMoreButton(), box.firstChild);
	// Keep the previously-visible messages in place after prepending older ones.
	box.scrollTop = oldT + (box.scrollHeight - oldH);
}

export function renderHistory(messages: any[]): void {
	if (!Array.isArray(messages) || messages.length === 0) return;
	clearConversation();
	historyBuffer = messages;
	windowStart = messages.length > INITIAL_WINDOW ? snapToTurnStart(messages.length - INITIAL_WINDOW) : 0;
	if (windowStart > 0) els().messages.appendChild(makeLoadMoreButton());
	for (let i = windowStart; i < messages.length; i++) renderOneMessage(messages[i]);
	// Seed the pinned panel from the last todo_write in the FULL transcript (it
	// may predate the rendered window), so the panel survives reload/switch.
	if (todoPanelEnabled) {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			const td = m?.details?.todos;
			if (m?.role === "toolResult" && Array.isArray(td) && td.length) {
				updateTodoPanel(td);
				break;
			}
		}
	}
	setEmptyVisibility();
	// Loading a session jumps to the latest and re-pins.
	forceScrollToBottom();
}

function renderAssistantHistory(m: any): void {
	const parts = Array.isArray(m.content) ? m.content : [];
	if (parts.length === 0) return;
	const bubble = appendBubble("assistant");
	let textBuf = "";
	let thinkingBuf = "";

	for (const p of parts) {
		if (!p || typeof p !== "object") continue;
		if (p.type === "text" && typeof p.text === "string") {
			textBuf += p.text;
		} else if (p.type === "thinking" && typeof p.thinking === "string") {
			thinkingBuf += p.thinking;
		} else if (p.type === "toolCall") {
			const tc = p as { id?: string; name?: string; arguments?: unknown };
			let toolsEl = bubble.querySelector<HTMLElement>(".msg-tools");
			if (!toolsEl) {
				toolsEl = document.createElement("div");
				toolsEl.className = "msg-tools";
				bubble.appendChild(toolsEl);
			}
			// Shared builder (no spinner — history calls are already complete).
			toolsEl.appendChild(
				buildToolCallBlock(String(tc.name ?? "?"), String(tc.id ?? Math.random()), tc.arguments),
			);
		}
	}

	if (thinkingBuf) {
		const wrap = document.createElement("details");
		wrap.className = "msg-thinking";
		const summary = document.createElement("summary");
		summary.textContent = "Thinking…";
		const body = document.createElement("div");
		body.className = "thinking-body";
		body.innerHTML = md(thinkingBuf);
		wrap.appendChild(summary);
		wrap.appendChild(body);
		bubble.insertBefore(wrap, bubble.firstChild);
	}
	if (textBuf && textBuf.trim()) {
		const textEl = document.createElement("div");
		textEl.className = "msg-text";
		textEl.innerHTML = md(textBuf);
		const toolsEl = bubble.querySelector(".msg-tools");
		if (toolsEl) bubble.insertBefore(textEl, toolsEl);
		else bubble.appendChild(textEl);
	}
}

function extractText(content: any): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((p) => p && p.type === "text" && typeof p.text === "string")
		.map((p) => p.text)
		.join("");
}

function extractImages(content: any): { data: string; mimeType: string }[] {
	if (!Array.isArray(content)) return [];
	return content
		.filter((p) => p && p.type === "image" && typeof p.data === "string")
		.map((p) => ({ data: p.data, mimeType: typeof p.mimeType === "string" ? p.mimeType : "image/png" }));
}

export function renderRecentList(): void {
	const recentList = els().recentList;
	recentList.innerHTML = "";
	if (ui.sessions.length === 0) {
		const empty = document.createElement("div");
		empty.className = "recent-empty";
		empty.textContent = t("chat.noSessions");
		recentList.appendChild(empty);
		return;
	}
	ui.sessions.slice(0, 5).forEach((s) => {
		const row = document.createElement("button");
		row.className = "recent-item";
		const m = s.name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
		const when = m ? `${m[1]} ${m[2]}:${m[3]}` : s.name;
		const idShort = s.name.split("_")[1]?.slice(0, 6) ?? "";
		row.innerHTML = `<span class="recent-time">${when}</span><span class="recent-id">${idShort}</span>`;
		row.addEventListener("click", () =>
			post({
				kind: FROM_WEBVIEW.COMMAND,
				command: { type: "switch_session", sessionPath: s.file },
			}),
		);
		recentList.appendChild(row);
	});
}
