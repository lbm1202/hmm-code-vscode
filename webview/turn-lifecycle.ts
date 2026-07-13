// Turn → bubble → status row lifecycle. Two parallel lifecycles per turn:
//
//   - Status row (turn-scoped, ensureStatus..removeStatus). Stays pinned at
//     the bottom of messagesEl through tool-execution gaps so the user sees
//     "tool running (name)" while tools run.
//   - Bubble (per-message, ensureBubble..finalizeBubble). New bubble for each
//     assistant message_start; finalized on message_end.
//
// PERF: markdown rendering on every text_delta is O(n²) in accumulated length.
// streamText/streamThinking append the delta to a chunks array and schedule a
// rAF-debounced render — at most one md(joinedText) per frame.

import { appendBubble, buildMessageFooter, buildThinkingSummary, els, scrollToBottomIfPinned, setEmptyVisibility } from "./dom";
import { md } from "./helpers";
import { t } from "./i18n";
import { FROM_WEBVIEW } from "./protocol";
import { post, runtime } from "./state";
import type { BubbleState, MsgTimings, StatusState } from "./types";
import { updateSendButton } from "./prompt";

export function ensureStatus(): StatusState {
	if (runtime.status) return runtime.status;
	const e = els();
	const row = document.createElement("div");
	row.className = "status-row";
	const dots = document.createElement("span");
	dots.className = "loading-dots";
	dots.innerHTML = "<span></span><span></span><span></span>";
	const textEl = document.createElement("span");
	textEl.className = "status-text";
	textEl.textContent = t("chat.status.waiting");
	const time = document.createElement("span");
	time.className = "status-time";
	time.textContent = "0s";
	row.append(dots, textEl, time);
	e.messages.appendChild(row);
	setEmptyVisibility();
	scrollToBottomIfPinned();
	const startedAt = Date.now();
	const timer = window.setInterval(() => {
		time.textContent = `${Math.floor((Date.now() - startedAt) / 1000)}s`;
	}, 250);
	runtime.status = { row, textEl, timer };
	return runtime.status;
}

/** Compat shim — older call sites still call ensureTurn(). */
export function ensureTurn(): void {
	ensureStatus();
	updateSendButton();
}

export function setStatusPhase(phase: string): void {
	if (runtime.status) runtime.status.textEl.textContent = phase;
}

export function removeStatus(): void {
	if (!runtime.status) return;
	runtime.status.row.remove();
	window.clearInterval(runtime.status.timer);
	runtime.status = null;
}

/** Keep the status row visually anchored to the bottom of messagesEl.
 *  Only re-append when it isn't ALREADY the last child — re-appending detaches
 *  and re-attaches the node, which restarts the loading-dots CSS animation. This
 *  is called on every stream delta, so an unconditional appendChild made the
 *  dots reset to frame 0 on each chunk; the guard keeps the animation smooth and
 *  only moves the row when something new was appended after it (bubble / tool). */
export function pinStatusToEnd(): void {
	if (!runtime.status) return;
	const messages = els().messages;
	if (messages.lastElementChild !== runtime.status.row) {
		messages.appendChild(runtime.status.row);
	}
}

export function ensureBubble(): BubbleState {
	ensureStatus();
	if (runtime.bubble) return runtime.bubble;
	const el = appendBubble("assistant");
	const textEl = document.createElement("div");
	textEl.className = "msg-text";
	el.appendChild(textEl);
	runtime.bubble = {
		bubble: el,
		textEl,
		thinkingEl: null,
		toolsEl: null,
		text: "",
		thinking: "",
		pendingRender: null,
		pendingThinkingRender: null,
		requestStartAt: runtime.requestMarkAt || Date.now(),
		firstDeltaAt: Date.now(),
		thinkingStartAt: null,
		thinkingEndAt: null,
		thinkingSummaryEl: null,
		thinkingAnim: null,
	};
	pinStatusToEnd();
	return runtime.bubble;
}

export function finalizeBubble(message?: any): void {
	// Flush any pending markdown render so the final state is committed.
	const b = runtime.bubble;
	if (b) {
		if (b.pendingRender !== null) {
			cancelAnimationFrame(b.pendingRender);
			b.pendingRender = null;
			renderTextNow(b);
		}
		if (b.pendingThinkingRender !== null) {
			cancelAnimationFrame(b.pendingThinkingRender);
			b.pendingThinkingRender = null;
			renderThinkingNow(b);
		}
		settleThinking();
		attachStats(b, message);
	}
	runtime.bubble = null;
}

/** Stop the "Thinking…" dots animation and stamp the final "Thought for N.Ns"
 *  label. Called when thinking gives way to text/tool output and when the
 *  message ends. Safe to call repeatedly (no-op once settled). */
export function settleThinking(): void {
	const b = runtime.bubble;
	if (!b || !b.thinkingSummaryEl || b.thinkingAnim === null) return;
	clearInterval(b.thinkingAnim);
	b.thinkingAnim = null;
	const secs =
		b.thinkingStartAt !== null
			? ((b.thinkingEndAt ?? Date.now()) - b.thinkingStartAt) / 1000
			: 0;
	b.thinkingSummaryEl.textContent = t("chat.thoughtFor", { s: secs.toFixed(1) });
	b.thinkingSummaryEl.closest("details")?.classList.remove("thinking-live");
}

/** Per-message footer (copy button + stats toggle) appended at the end of the
 *  bubble; timings are measured from the event stream and persisted for replay. */
function attachStats(b: BubbleState, message?: any): void {
	if (!b.text.trim() && !b.thinking.trim()) return; // tool-only / empty bubble
	const now = Date.now();
	const tm: MsgTimings = {
		ttftMs: Math.max(0, b.firstDeltaAt - b.requestStartAt),
		genMs: Math.max(0, now - b.firstDeltaAt),
		totalMs: Math.max(0, now - b.requestStartAt),
		thinkMs:
			b.thinkingStartAt !== null ? Math.max(0, (b.thinkingEndAt ?? now) - b.thinkingStartAt) : 0,
	};
	const footer = buildMessageFooter({
		copyText: b.text.trim() || undefined,
		usage: message?.usage,
		timings: tm,
	});
	if (footer) b.bubble.appendChild(footer);

	// Persist INTO the session transcript: Pi's internal /stats-record command
	// appends a webview-stats custom entry (clean dispatch, no LLM turn), so
	// the display survives reloads and travels with the session file.
	const key = message?.timestamp != null ? String(message.timestamp) : "";
	if (key) {
		post({
			kind: FROM_WEBVIEW.SLASH,
			text: `/stats-record ${JSON.stringify({ key, stats: tm })}`,
		});
	}
}

export function finalizeTurn(): void {
	removeStatus();
	finalizeBubble();
	// Catch-all: clear any tool-call spinners whose result never matched. The
	// per-block result path (updateToolResult) keys on data-tool-call-id; if Pi's
	// toolcall_end id and tool_execution_end toolCallId ever diverge — or an end
	// event is dropped — the block's ⏳ would spin forever. A turn boundary means
	// every tool for that turn is done, so any spinner still up is orphaned.
	els().messages.querySelectorAll(".tool-spinner").forEach((sp) => sp.remove());
	updateSendButton();
}

/** PERF: append to chunked text + schedule one render per frame. */
export function streamText(delta: string): void {
	const b = ensureBubble();
	// Visible text starting = the reasoning phase is over for this message.
	if (b.thinkingAnim !== null) settleThinking();
	b.text += delta;
	scheduleTextRender(b);
	pinStatusToEnd();
	scrollToBottomIfPinned();
}

export function streamThinking(delta: string): void {
	if (!delta) return;
	const b = ensureBubble();
	b.thinking += delta;
	if (b.thinkingStartAt === null) b.thinkingStartAt = Date.now();
	b.thinkingEndAt = Date.now();
	setStatusPhase(t("chat.status.thinking"));
	if (!b.thinkingEl) {
		const wrap = document.createElement("details");
		// thinking-live drives the icon pulse; removed when reasoning settles.
		wrap.className = "msg-thinking thinking-live";
		const { summary, label } = buildThinkingSummary(t("chat.thinking"));
		const body = document.createElement("div");
		body.className = "thinking-body";
		wrap.append(summary, body);
		b.bubble.insertBefore(wrap, b.textEl);
		b.thinkingEl = body;
		b.thinkingSummaryEl = label; // label span — the icon/chevron stay put
		// Animated "Thinking." → ".." → "..." while reasoning streams; replaced
		// with "Thought for N.Ns" by settleThinking().
		let dots = 0;
		b.thinkingAnim = window.setInterval(() => {
			dots = (dots % 3) + 1;
			label.textContent = t("chat.thinking") + ".".repeat(dots);
		}, 400);
	}
	scheduleThinkingRender(b);
	pinStatusToEnd();
}

function scheduleTextRender(b: BubbleState): void {
	if (b.pendingRender !== null) return;
	b.pendingRender = requestAnimationFrame(() => {
		b.pendingRender = null;
		renderTextNow(b);
	});
}

function renderTextNow(b: BubbleState): void {
	const isBlank = b.text.trim().length === 0;
	b.textEl.classList.toggle("hidden", isBlank);
	if (!isBlank) b.textEl.innerHTML = md(b.text);
	// Scroll AFTER the DOM grows (this runs in a rAF, a frame after streamText's
	// own scroll) so autoscroll tracks the rendered height, not the pre-render one.
	scrollToBottomIfPinned();
}

function scheduleThinkingRender(b: BubbleState): void {
	if (b.pendingThinkingRender !== null) return;
	b.pendingThinkingRender = requestAnimationFrame(() => {
		b.pendingThinkingRender = null;
		renderThinkingNow(b);
	});
}

function renderThinkingNow(b: BubbleState): void {
	if (b.thinkingEl) b.thinkingEl.innerHTML = md(b.thinking);
	// streamThinking never scrolls (unlike streamText), so thinking growth left the
	// view behind. Track it here, after the thinking block grows.
	scrollToBottomIfPinned();
}
