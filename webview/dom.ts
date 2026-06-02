// HTML scaffold + cached element references + simple bubble appenders.
// Imported once at boot by main.ts; the exported `els` map and helper fns
// are the single source of truth for DOM access in the rest of the webview.

import { t } from "./i18n";

// Inline SVG logo (avoids CSP / webview-asset URI plumbing for static art).
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 64" aria-hidden="true">
	<g style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-weight: 900;">
		<text x="74" y="52" text-anchor="middle" font-size="56" fill="none" stroke="#1a4d1a" stroke-width="1.4">Hmm</text>
		<text x="71" y="49" text-anchor="middle" font-size="56" fill="none" stroke="#2d7a2d" stroke-width="1.4">Hmm</text>
		<text x="68" y="46" text-anchor="middle" font-size="56" fill="#5fff5f" stroke="#3a9c3a" stroke-width="1">Hmm</text>
	</g>
</svg>`;

// chat-backend.ts injects { version, publisher } from the extension's
// package.json into window.__HMM_INFO via a <script> tag before main.js
// loads. Falls back to a placeholder if the host forgot (shouldn't happen).
const __info = (window as any).__HMM_INFO as { version?: string; publisher?: string } | undefined;
const VERSION_LINE = `v${__info?.version ?? "?"} · ${__info?.publisher ?? "?"}`;

const APP_HTML = `
	<div class="topbar">
		<div class="topbar-title">Hmm-code</div>
		<div class="topbar-actions">
			<button class="iconbtn" id="btn-new-session" title="${t("chat.newSessionBtn")}">＋</button>
			<button class="iconbtn" id="btn-sessions" title="${t("chat.resumeSessionBtn")}">🕘</button>
			<button class="iconbtn" id="btn-settings" title="${t("chat.settingsBtn")}">⚙</button>
		</div>
	</div>
	<div class="messages" id="messages"></div>
	<div class="empty-state hidden" id="empty-state">
		<div class="empty-logo">${LOGO_SVG}</div>
		<div class="empty-title">Hmm-code</div>
		<div class="empty-version">${VERSION_LINE}</div>
		<div class="empty-subtitle">Plan · Code · Debug · Ask</div>
		<div class="recent-section">
			<div class="recent-header">${t("chat.recentSessions")}</div>
			<div class="recent-list" id="recent-list"></div>
		</div>
	</div>
	<div class="prompt-area">
		<div class="slash-menu hidden" id="slash-menu"></div>
		<textarea id="prompt-input" rows="3" placeholder="${t("chat.promptPlaceholder")}" autofocus></textarea>
		<div class="prompt-footer">
			<div class="picker-row">
				<button class="picker" id="picker-mode"><span class="picker-label">code</span><span class="picker-caret">▲</span></button>
				<button class="picker" id="picker-model"><span class="picker-label">—</span><span class="picker-caret">▲</span></button>
				<button class="picker" id="picker-thinking"><span class="picker-label">—</span><span class="picker-caret">▲</span></button>
				<button class="picker hidden" id="btn-reset" title="${t("chat.resetTitle")}">↺ ${t("chat.resetLabel")}</button>
				<button class="picker autoapprove off" id="btn-autoapprove" title="${t("chat.autoApproveTitle")}">🔒 Auto</button>
				<button class="picker hidden" id="btn-compact" title="${t("chat.compactTitle")}">🗜 ${t("chat.compactLabel")}</button>
			</div>
			<div class="footer-right">
				<span class="ctx-pill" id="ctx-pill">ctx —</span>
				<button class="sendbtn" id="send-btn" title="Send (Enter)">↑</button>
			</div>
		</div>
	</div>
	<div id="modal-root"></div>
	<div id="popover-root"></div>
`;

export interface DomRefs {
	messages: HTMLElement;
	empty: HTMLElement;
	recentList: HTMLElement;
	prompt: HTMLTextAreaElement;
	slashMenu: HTMLElement;
	send: HTMLElement;
	modalRoot: HTMLElement;
	popoverRoot: HTMLElement;
	pickerMode: HTMLElement;
	pickerModel: HTMLElement;
	pickerThinking: HTMLElement;
	pickerModeLabel: HTMLElement;
	pickerModelLabel: HTMLElement;
	pickerThinkingLabel: HTMLElement;
	ctxPill: HTMLElement;
	btnNew: HTMLElement;
	btnSessions: HTMLElement;
	btnSettings: HTMLElement;
	btnReset: HTMLElement;
	btnAutoApprove: HTMLElement;
	btnCompact: HTMLElement;
}

/** Mounts the app scaffold into #app and returns refs to all interactive nodes. */
function mountDom(root: HTMLElement): DomRefs {
	root.innerHTML = APP_HTML;
	const pickerMode = document.getElementById("picker-mode")!;
	const pickerModel = document.getElementById("picker-model")!;
	const pickerThinking = document.getElementById("picker-thinking")!;
	return {
		messages: document.getElementById("messages")!,
		empty: document.getElementById("empty-state")!,
		recentList: document.getElementById("recent-list")!,
		prompt: document.getElementById("prompt-input") as HTMLTextAreaElement,
		slashMenu: document.getElementById("slash-menu")!,
		send: document.getElementById("send-btn")!,
		modalRoot: document.getElementById("modal-root")!,
		popoverRoot: document.getElementById("popover-root")!,
		pickerMode,
		pickerModel,
		pickerThinking,
		pickerModeLabel: pickerMode.querySelector(".picker-label") as HTMLElement,
		pickerModelLabel: pickerModel.querySelector(".picker-label") as HTMLElement,
		pickerThinkingLabel: pickerThinking.querySelector(".picker-label") as HTMLElement,
		ctxPill: document.getElementById("ctx-pill")!,
		btnNew: document.getElementById("btn-new-session")!,
		btnSessions: document.getElementById("btn-sessions")!,
		btnSettings: document.getElementById("btn-settings")!,
		btnReset: document.getElementById("btn-reset")!,
		btnAutoApprove: document.getElementById("btn-autoapprove")!,
		btnCompact: document.getElementById("btn-compact")!,
	};
}

let _els: DomRefs;
/** Initialise the singleton DOM refs (call once at boot). */
export function initDom(root: HTMLElement): DomRefs {
	_els = mountDom(root);
	// Track whether the user is pinned to the bottom. Scrolling up unpins
	// (streaming stops dragging the view down); scrolling back re-pins.
	_els.messages.addEventListener("scroll", () => {
		scrollPinned = nearBottom(_els.messages);
	});
	return _els;
}
/** Singleton DOM refs accessor. */
export const els = (): DomRefs => _els;

/** Autoscroll pin: true while the user is at/near the bottom of the message
 *  list. Set false when they scroll up so streaming output doesn't drag the
 *  viewport down; set true again when they return to the bottom. */
let scrollPinned = true;
const SCROLL_PIN_THRESHOLD_PX = 60;

function nearBottom(el: HTMLElement): boolean {
	return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_PIN_THRESHOLD_PX;
}

/** Scroll to the bottom ONLY if the user is currently pinned there — for
 *  streaming/append paths, so reading scrollback isn't fought by autoscroll. */
export function scrollToBottomIfPinned(): void {
	if (scrollPinned) _els.messages.scrollTop = _els.messages.scrollHeight;
}

/** Force-scroll to the bottom and re-pin — for user-driven events (sending a
 *  message, loading a session) where jumping to the latest is expected. */
export function forceScrollToBottom(): void {
	scrollPinned = true;
	_els.messages.scrollTop = _els.messages.scrollHeight;
}

/** Toggle empty-state placeholder based on whether messagesEl has children. */
export function setEmptyVisibility(): void {
	const e = _els;
	const hasContent = e.messages.children.length > 0;
	e.empty.classList.toggle("hidden", hasContent);
	e.messages.classList.toggle("hidden", !hasContent);
}

export function appendBubble(role: "user" | "assistant" | "system"): HTMLElement {
	const e = _els;
	const div = document.createElement("div");
	div.className = `bubble bubble-${role}`;
	e.messages.appendChild(div);
	scrollToBottomIfPinned();
	setEmptyVisibility();
	return div;
}

export function appendUserBubble(text: string): void {
	const div = appendBubble("user");
	// User messages render as plain text with pre-wrap. Avoid markdown <p> wrapping
	// which adds extra spacing around short messages.
	div.textContent = text;
	// Sending a message is an explicit action — always jump to it and re-pin.
	forceScrollToBottom();
}

export function appendSystem(text: string): void {
	if (!text) return;
	const div = appendBubble("system");
	div.textContent = text;
}

/** Append the collapsed "context compacted — view summary" block. Used both at
 *  runtime (compaction_end) and when replaying history (Pi keeps the summary as a
 *  `compactionSummary` message, so it survives reload / session switch). */
export function appendCompactionSummary(summary: string): void {
	const div = appendBubble("system");
	const details = document.createElement("details");
	details.className = "compaction-summary";
	const head = document.createElement("summary");
	head.textContent = t("chat.compactedTitle");
	details.appendChild(head);
	const body = document.createElement("div");
	body.className = "compaction-summary-body";
	body.textContent = summary.trim() || t("chat.compactedNoSummary");
	details.appendChild(body);
	div.appendChild(details);
}
