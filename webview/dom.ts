// HTML scaffold + cached element references + simple bubble appenders.
// Imported once at boot by main.ts; the exported `els` map and helper fns
// are the single source of truth for DOM access in the rest of the webview.

import { t } from "./i18n";
import type { MsgTimings } from "./types";

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

// Topbar icons: plain text symbols chosen from NON-emoji codepoints so they
// render monochrome in the editor foreground everywhere. The previous 🕘/📊
// are Emoji_Presentation codepoints (always color), and inline SVGs collapsed
// in the webview — text glyphs sidestep both. U+FE0E forces text presentation
// on ⚙ (emoji-capable but text-default; the selector pins it).
const ICON_PLUS = "＋"; // U+FF0B fullwidth plus
const ICON_HISTORY = "◷"; // U+25F7 circle with upper-right quadrant (clock face)
const ICON_USAGE = "▁▄▇"; // block elements — mini bar chart
const ICON_GEAR = "⚙︎"; // U+2699 gear, text presentation

const APP_HTML = `
	<div class="topbar">
		<div class="topbar-title">Hmm-code</div>
		<div class="topbar-actions">
			<button class="iconbtn" id="btn-new-session" title="${t("chat.newSessionBtn")}">${ICON_PLUS}</button>
			<button class="iconbtn" id="btn-sessions" title="${t("chat.resumeSessionBtn")}">${ICON_HISTORY}</button>
			<button class="iconbtn" id="btn-usage" title="${t("chat.usageBtn")}">${ICON_USAGE}</button>
			<button class="iconbtn" id="btn-settings" title="${t("chat.settingsBtn")}">${ICON_GEAR}</button>
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
	btnUsage: HTMLElement;
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
		btnUsage: document.getElementById("btn-usage")!,
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
	opts?: { queued?: boolean },
): HTMLElement {
	const div = appendBubble("user");
	if (opts?.queued) {
		// Mid-turn steering: dimmed until Pi delivers it at the next tool
		// boundary (dispatch.ts removes the class on queue_update).
		div.classList.add("queued");
		div.title = t("chat.queuedTitle");
	}
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
	return div;
}

export function appendSystem(text: string): void {
	if (!text) return;
	const div = appendBubble("system");
	div.textContent = text;
}

/** Abbreviated token count: 845 → "845", 3_120 → "3.1k", 1_240_000 → "1.2m".
 *  Trailing ".0" is dropped (2.0k → "2k"). */
export function fmtTokens(n: number): string {
	const fmt = (v: number, suffix: string) => {
		const s = v.toFixed(1).replace(/\.0$/, "");
		return `${s}${suffix}`;
	};
	if (n >= 1_000_000) return fmt(n / 1_000_000, "m");
	if (n >= 1_000) return fmt(n / 1_000, "k");
	return String(n);
}

const COPY_SVG =
	'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_SVG =
	'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const STATS_SVG =
	'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>';

function writeClipboard(text: string): void {
	try {
		if (navigator.clipboard?.writeText) {
			void navigator.clipboard.writeText(text);
			return;
		}
	} catch {
		/* fall through to the textarea path */
	}
	const ta = document.createElement("textarea");
	ta.value = text;
	ta.style.position = "fixed";
	ta.style.opacity = "0";
	document.body.appendChild(ta);
	ta.select();
	try {
		document.execCommand("copy");
	} catch {
		/* clipboard unavailable — nothing else to try */
	}
	ta.remove();
}

function iconButton(svg: string, title: string): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.className = "msg-action-btn";
	btn.type = "button";
	btn.innerHTML = svg;
	btn.title = title;
	return btn;
}

/** Bottom action row for an assistant message: right-aligned icon buttons —
 *  copy-response and (when timings exist) a stats toggle that expands the
 *  labeled breakdown grid below the icons. Shared by the live stream
 *  (turn-lifecycle) and history replay. Returns null when there is nothing
 *  to show (no text to copy, no timings). */
export function buildMessageFooter(opts: {
	copyText?: string;
	usage?: { input?: number; output?: number; cacheRead?: number };
	timings?: MsgTimings;
}): HTMLElement | null {
	const { copyText, usage, timings } = opts;
	if (!copyText && !timings) return null;

	const footer = document.createElement("div");
	footer.className = "msg-footer";
	const actions = document.createElement("div");
	actions.className = "msg-actions";
	footer.appendChild(actions);

	if (copyText) {
		const btn = iconButton(COPY_SVG, t("chat.copy"));
		btn.addEventListener("click", () => {
			writeClipboard(copyText);
			btn.innerHTML = CHECK_SVG;
			btn.title = t("chat.copied");
			btn.classList.add("ok");
			setTimeout(() => {
				btn.innerHTML = COPY_SVG;
				btn.title = t("chat.copy");
				btn.classList.remove("ok");
			}, 1200);
		});
		actions.appendChild(btn);
	}

	if (timings) {
		const out = usage?.output ?? 0;
		const promptTokens = (usage?.input ?? 0) + (usage?.cacheRead ?? 0);
		const thinkS = timings.thinkMs / 1000;

		const rows: [string, string][] = [];
		if (promptTokens > 0) {
			const cached = usage?.cacheRead ?? 0;
			rows.push([
				t("chat.stats.prompt"),
				`${fmtTokens(promptTokens)} tokens${cached > 0 ? ` (${fmtTokens(cached)} ${t("chat.stats.cached")})` : ""}`,
			]);
		}
		if (out > 0) rows.push([t("chat.stats.generated"), `${fmtTokens(out)} tokens`]);
		if (thinkS > 0.05) rows.push([t("chat.stats.thinking"), `${thinkS.toFixed(1)}s`]);
		rows.push([t("chat.stats.ttft"), `${(timings.ttftMs / 1000).toFixed(2)}s`]);
		if (out > 0 && timings.genMs > 200) {
			rows.push([t("chat.stats.genSpeed"), `${(out / (timings.genMs / 1000)).toFixed(1)} tok/s`]);
		}
		rows.push([t("chat.stats.total"), `${(timings.totalMs / 1000).toFixed(1)}s`]);

		const body = document.createElement("div");
		body.className = "stats-body hidden";
		for (const [label, value] of rows) {
			const row = document.createElement("div");
			row.className = "stats-row";
			const l = document.createElement("span");
			l.className = "stats-label";
			l.textContent = label;
			const v = document.createElement("span");
			v.className = "stats-value";
			v.textContent = value;
			row.append(l, v);
			body.appendChild(row);
		}
		footer.appendChild(body);

		const summary = `${(timings.totalMs / 1000).toFixed(1)}s${out > 0 ? ` · ${fmtTokens(out)} tokens` : ""}`;
		const btn = iconButton(STATS_SVG, summary);
		btn.addEventListener("click", () => {
			const open = !body.classList.toggle("hidden");
			btn.classList.toggle("active", open);
		});
		actions.appendChild(btn);
	}

	return footer;
}

/** Header row for the thinking <details> block: sparkle icon on the left, the
 *  live label ("Thinking…" / "Thought for Ns") in the middle, and a chevron
 *  pinned to the right that rotates on open/close (CSS transition). Shared by
 *  the live stream (turn-lifecycle) and history replay so both look identical.
 *  Callers update ONLY the returned label element — replacing the summary's
 *  textContent would wipe the icon/chevron. */
export function buildThinkingSummary(initialLabel: string): {
	summary: HTMLElement;
	label: HTMLElement;
} {
	const summary = document.createElement("summary");
	const icon = document.createElement("span");
	icon.className = "think-icon";
	icon.innerHTML =
		'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>';
	const label = document.createElement("span");
	label.className = "think-label";
	label.textContent = initialLabel;
	const chevron = document.createElement("span");
	chevron.className = "think-chevron";
	chevron.innerHTML =
		'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
	summary.append(icon, label, chevron);
	return { summary, label };
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
