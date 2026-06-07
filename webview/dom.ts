// HTML scaffold + cached element references + simple bubble appenders.
// Imported once at boot by main.ts; the exported `els` map and helper fns
// are the single source of truth for DOM access in the rest of the webview.

import { t } from "./i18n";

// Inline SVG logo (avoids CSP / webview-asset URI plumbing for static art).
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 64" aria-hidden="true">
	<g style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-weight: 900;">
		<text x="74" y="52" text-anchor="middle" font-size="56" fill="none" stroke="#173e5c" stroke-width="1.4">Hmm</text>
		<text x="71" y="49" text-anchor="middle" font-size="56" fill="none" stroke="#2d8fc8" stroke-width="1.4">Hmm</text>
		<text x="68" y="46" text-anchor="middle" font-size="56" fill="#5fd3ff" stroke="#3a9cd6" stroke-width="1">Hmm</text>
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
	<div class="todo-panel hidden" id="todo-panel"></div>
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
		<div class="attachments hidden" id="attachments"></div>
		<input type="file" id="file-input" accept="image/*" multiple hidden />
		<textarea id="prompt-input" rows="1" placeholder="${t("chat.promptPlaceholder")}" autofocus></textarea>
		<div class="prompt-footer">
			<div class="footer-left">
				<button class="composer-icon" id="btn-attach" title="${t("chat.attachTitle")}">＋</button>
				<button class="composer-icon" id="btn-slash" title="${t("chat.slashTitle")}">/</button>
				<button class="composer-icon hidden" id="btn-compact" title="${t("chat.compactTitle")}">🗜</button>
				<span class="ctx-pill" id="ctx-pill"><span class="ctx-prefix">ctx</span><span class="ctx-value" id="ctx-value">—</span></span>
			</div>
			<div class="footer-right">
				<button class="picker hidden" id="btn-reset" title="${t("chat.resetTitle")}">↺<span class="reset-label"> ${t("chat.resetLabel")}</span></button>
				<button class="picker" id="picker-mode"><span class="picker-mode-icon" id="picker-mode-icon"></span><span class="picker-label">code</span><span class="picker-caret">▾</span></button>
				<button class="sendbtn" id="send-btn" title="Send (Enter)">↑</button>
			</div>
		</div>
	</div>
	<div id="modal-root"></div>
	<div id="popover-root"></div>
`;

export interface DomRefs {
	messages: HTMLElement;
	todoPanel: HTMLElement;
	empty: HTMLElement;
	recentList: HTMLElement;
	prompt: HTMLTextAreaElement;
	slashMenu: HTMLElement;
	attachments: HTMLElement;
	btnAttach: HTMLElement;
	btnSlash: HTMLElement;
	fileInput: HTMLInputElement;
	send: HTMLElement;
	modalRoot: HTMLElement;
	popoverRoot: HTMLElement;
	pickerMode: HTMLElement;
	pickerModeLabel: HTMLElement;
	pickerModeIcon: HTMLElement;
	ctxPill: HTMLElement;
	ctxValue: HTMLElement;
	btnNew: HTMLElement;
	btnSessions: HTMLElement;
	btnSettings: HTMLElement;
	btnReset: HTMLElement;
	btnCompact: HTMLElement;
}

/** Mounts the app scaffold into #app and returns refs to all interactive nodes. */
function mountDom(root: HTMLElement): DomRefs {
	root.innerHTML = APP_HTML;
	const pickerMode = document.getElementById("picker-mode")!;
	return {
		messages: document.getElementById("messages")!,
		todoPanel: document.getElementById("todo-panel")!,
		empty: document.getElementById("empty-state")!,
		recentList: document.getElementById("recent-list")!,
		prompt: document.getElementById("prompt-input") as HTMLTextAreaElement,
		slashMenu: document.getElementById("slash-menu")!,
		attachments: document.getElementById("attachments")!,
		btnAttach: document.getElementById("btn-attach")!,
		btnSlash: document.getElementById("btn-slash")!,
		fileInput: document.getElementById("file-input") as HTMLInputElement,
		send: document.getElementById("send-btn")!,
		modalRoot: document.getElementById("modal-root")!,
		popoverRoot: document.getElementById("popover-root")!,
		pickerMode,
		pickerModeLabel: pickerMode.querySelector(".picker-label") as HTMLElement,
		pickerModeIcon: document.getElementById("picker-mode-icon")!,
		ctxPill: document.getElementById("ctx-pill")!,
		ctxValue: document.getElementById("ctx-value")!,
		btnNew: document.getElementById("btn-new-session")!,
		btnSessions: document.getElementById("btn-sessions")!,
		btnSettings: document.getElementById("btn-settings")!,
		btnReset: document.getElementById("btn-reset")!,
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

/** Default filename for an image that arrived without one (paste / replay). */
export function defaultImageName(mimeType: string): string {
	const ext = mimeType === "image/jpeg" ? "jpg" : (/image\/(\w+)/.exec(mimeType)?.[1] ?? "png");
	return `image.${ext}`;
}

/** Fullscreen image preview, opened by clicking an image badge. Layers over
 *  whatever else is mounted in modalRoot (removes only its own backdrop). */
export function showImageLightbox(dataUrl: string): void {
	const root = els().modalRoot;
	const backdrop = document.createElement("div");
	backdrop.className = "lightbox-backdrop";
	const img = document.createElement("img");
	img.className = "lightbox-img";
	img.src = dataUrl;
	const close = document.createElement("button");
	close.className = "lightbox-close";
	close.textContent = "×";
	close.title = t("chat.lightboxClose");
	const dismiss = () => {
		backdrop.remove();
		document.removeEventListener("keydown", onKey);
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") dismiss();
	};
	close.addEventListener("click", dismiss);
	backdrop.addEventListener("click", (e) => {
		if (e.target === backdrop) dismiss(); // click outside the image
	});
	document.addEventListener("keydown", onKey);
	backdrop.append(img, close);
	root.appendChild(backdrop);
}

/** Compact image badge (thumbnail + filename + dimensions). Used both as a
 *  composer attachment chip (removable) and inside a sent user bubble. Clicking
 *  the badge (but not its × button) opens the fullscreen preview; the W×H is
 *  read from the image once it loads. */
export function buildImageBadge(opts: {
	dataUrl: string;
	name: string;
	onRemove?: () => void;
}): HTMLElement {
	const chip = document.createElement("div");
	chip.className = "attachment-chip";
	chip.title = opts.name;

	const thumb = document.createElement("img");
	thumb.className = "attachment-thumb";
	thumb.src = opts.dataUrl;
	thumb.alt = t("chat.imageAlt");

	const nameEl = document.createElement("span");
	nameEl.className = "attachment-name";
	nameEl.textContent = opts.name;
	// Dimensions sit inline after the name (gray), filled once the image loads.
	const dims = document.createElement("span");
	dims.className = "attachment-dims";
	thumb.addEventListener("load", () => {
		if (thumb.naturalWidth) dims.textContent = `${thumb.naturalWidth}×${thumb.naturalHeight}`;
	});

	chip.append(thumb, nameEl, dims);
	chip.addEventListener("click", () => showImageLightbox(opts.dataUrl));

	if (opts.onRemove) {
		const rm = document.createElement("button");
		rm.className = "attachment-remove";
		rm.title = t("chat.attachRemove");
		rm.textContent = "×";
		rm.addEventListener("click", (e) => {
			e.stopPropagation(); // don't open the lightbox
			opts.onRemove!();
		});
		chip.appendChild(rm);
	}
	return chip;
}

export function appendUserBubble(
	text: string,
	images?: { data: string; mimeType: string; name?: string }[],
): void {
	const div = appendBubble("user");
	// User messages render as plain text with pre-wrap. Avoid markdown <p> wrapping
	// which adds extra spacing around short messages.
	if (images && images.length) {
		const wrap = document.createElement("div");
		wrap.className = "msg-images";
		for (const im of images) {
			wrap.appendChild(
				buildImageBadge({
					dataUrl: `data:${im.mimeType};base64,${im.data}`,
					name: im.name || defaultImageName(im.mimeType),
				}),
			);
		}
		div.appendChild(wrap);
		if (text) {
			const tx = document.createElement("div");
			tx.className = "msg-usertext";
			tx.textContent = text;
			div.appendChild(tx);
		}
	} else {
		div.textContent = text;
	}
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
