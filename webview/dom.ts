// HTML scaffold + cached element references + simple bubble appenders.
// Imported once at boot by main.ts; the exported `els` map and helper fns
// are the single source of truth for DOM access in the rest of the webview.

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
			<button class="iconbtn" id="btn-new-session" title="New session">＋</button>
			<button class="iconbtn" id="btn-sessions" title="Resume session">🕘</button>
			<button class="iconbtn" id="btn-settings" title="설정 (공급자 인증 / 모델 / 설정)">⚙</button>
		</div>
	</div>
	<div class="messages" id="messages"></div>
	<div class="empty-state hidden" id="empty-state">
		<div class="empty-logo">${LOGO_SVG}</div>
		<div class="empty-title">Hmm-code</div>
		<div class="empty-version">${VERSION_LINE}</div>
		<div class="empty-subtitle">Plan · Code · Debug · Ask</div>
		<div class="recent-section">
			<div class="recent-header">최근 세션</div>
			<div class="recent-list" id="recent-list"></div>
		</div>
	</div>
	<div class="prompt-area">
		<textarea id="prompt-input" rows="3" placeholder="메시지를 입력하세요… (Enter로 전송, Shift+Enter 줄바꿈, Tab 모드 전환)" autofocus></textarea>
		<div class="prompt-footer">
			<div class="picker-row">
				<button class="picker" id="picker-mode"><span class="picker-label">code</span><span class="picker-caret">▲</span></button>
				<button class="picker" id="picker-model"><span class="picker-label">—</span><span class="picker-caret">▲</span></button>
				<button class="picker" id="picker-thinking"><span class="picker-label">—</span><span class="picker-caret">▲</span></button>
				<button class="picker hidden" id="btn-reset" title="모드 기본값으로 모델/추론 재설정">↺ 기본값</button>
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
}

/** Mounts the app scaffold into #app and returns refs to all interactive nodes. */
export function mountDom(root: HTMLElement): DomRefs {
	root.innerHTML = APP_HTML;
	const pickerMode = document.getElementById("picker-mode")!;
	const pickerModel = document.getElementById("picker-model")!;
	const pickerThinking = document.getElementById("picker-thinking")!;
	return {
		messages: document.getElementById("messages")!,
		empty: document.getElementById("empty-state")!,
		recentList: document.getElementById("recent-list")!,
		prompt: document.getElementById("prompt-input") as HTMLTextAreaElement,
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
	};
}

let _els: DomRefs;
/** Initialise the singleton DOM refs (call once at boot). */
export function initDom(root: HTMLElement): DomRefs {
	_els = mountDom(root);
	return _els;
}
/** Singleton DOM refs accessor. */
export const els = (): DomRefs => _els;

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
	e.messages.scrollTop = e.messages.scrollHeight;
	setEmptyVisibility();
	return div;
}

export function appendUserBubble(text: string): void {
	const div = appendBubble("user");
	// User messages render as plain text with pre-wrap. Avoid markdown <p> wrapping
	// which adds extra spacing around short messages.
	div.textContent = text;
}

export function appendSystem(text: string): void {
	if (!text) return;
	const div = appendBubble("system");
	div.textContent = text;
}
