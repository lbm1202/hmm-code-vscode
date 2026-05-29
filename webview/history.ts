// Conversation history rendering: replay past messages from get_messages and
// build the "recent sessions" list on the empty state.

import { appendBubble, appendUserBubble, els, setEmptyVisibility } from "./dom";
import { md } from "./helpers";
import { t } from "./i18n";
import { showModal } from "./modals";
import { FROM_WEBVIEW } from "./protocol";
import { pendingUiRequests, post, ui } from "./state";
import { buildToolCallBlock, updateToolResult } from "./tools";
import { finalizeTurn } from "./turn-lifecycle";

/** Clear all messages and re-render any pending UI requests. */
export function clearConversation(): void {
	finalizeTurn();
	els().messages.innerHTML = "";
	setEmptyVisibility();
	// Re-render any UI requests we were waiting on. The Pi-side awaits are
	// still pending under the same ids, so reply correlation still works.
	for (const req of pendingUiRequests.values()) {
		showModal(req);
	}
}

export function renderHistory(messages: any[]): void {
	if (!Array.isArray(messages) || messages.length === 0) return;
	clearConversation();
	for (const m of messages) {
		if (!m || typeof m !== "object") continue;
		const role = m.role;
		if (role === "user") {
			const text = extractText(m.content);
			if (text) appendUserBubble(text);
		} else if (role === "assistant") {
			renderAssistantHistory(m);
		} else if (role === "toolResult") {
			const tcid = String(m.toolCallId ?? "?");
			const ok = !m.isError;
			// Pass full message-as-result so formatInteractiveResult can read
			// details.todos / details.answers etc. and pretty-render.
			updateToolResult(tcid, ok, { content: m.content, details: m.details });
		}
		// other roles (custom, etc) — skip for V0
	}
	setEmptyVisibility();
	const e = els();
	e.messages.scrollTop = e.messages.scrollHeight;
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
