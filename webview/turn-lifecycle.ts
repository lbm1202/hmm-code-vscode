// Turn → bubble → status row lifecycle. Two parallel lifecycles per turn:
//
//   - Status row (turn-scoped, ensureStatus..removeStatus). Stays pinned at
//     the bottom of messagesEl through tool-execution gaps so the user sees
//     "도구 실행 중 (name)" while tools run.
//   - Bubble (per-message, ensureBubble..finalizeBubble). New bubble for each
//     assistant message_start; finalized on message_end.
//
// PERF: markdown rendering on every text_delta is O(n²) in accumulated length.
// streamText/streamThinking append the delta to a chunks array and schedule a
// rAF-debounced render — at most one md(joinedText) per frame.

import { appendBubble, els, setEmptyVisibility } from "./dom";
import { md } from "./helpers";
import { runtime } from "./state";
import type { BubbleState, StatusState } from "./types";
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
	textEl.textContent = "응답 대기 중";
	const time = document.createElement("span");
	time.className = "status-time";
	time.textContent = "0s";
	row.append(dots, textEl, time);
	e.messages.appendChild(row);
	setEmptyVisibility();
	e.messages.scrollTop = e.messages.scrollHeight;
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

/** Keep the status row visually anchored to the bottom of messagesEl. */
export function pinStatusToEnd(): void {
	if (runtime.status) els().messages.appendChild(runtime.status.row);
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
	};
	pinStatusToEnd();
	return runtime.bubble;
}

export function finalizeBubble(): void {
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
	}
	runtime.bubble = null;
}

export function finalizeTurn(): void {
	removeStatus();
	finalizeBubble();
	updateSendButton();
}

/** PERF: append to chunked text + schedule one render per frame. */
export function streamText(delta: string): void {
	const b = ensureBubble();
	b.text += delta;
	scheduleTextRender(b);
	pinStatusToEnd();
	els().messages.scrollTop = els().messages.scrollHeight;
}

export function streamThinking(delta: string): void {
	if (!delta) return;
	const b = ensureBubble();
	b.thinking += delta;
	setStatusPhase("생각하는 중");
	if (!b.thinkingEl) {
		const wrap = document.createElement("details");
		wrap.className = "msg-thinking";
		const summary = document.createElement("summary");
		summary.textContent = "Thinking…";
		const body = document.createElement("div");
		body.className = "thinking-body";
		wrap.append(summary, body);
		b.bubble.insertBefore(wrap, b.textEl);
		b.thinkingEl = body;
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
}
