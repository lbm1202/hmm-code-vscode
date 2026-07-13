// The mode picker button opens a single tabbed popover with a left side-tab
// toggle: [Mode | Model]. The Mode tab lists modes (with icons + descriptions)
// plus an Auto-approve switch; the Model tab lists models plus an Effort slider.
// There is no separate model button. Selecting an item keeps the popover open
// (only re-clicking the anchor or clicking outside dismisses it).

import { els } from "./dom";
import { t } from "./i18n";
import { FROM_WEBVIEW, MODE_COLORS, MODE_NAMES, THINKING_LEVELS } from "./protocol";
import { post, runtime, ui } from "./state";

type PickerOption = {
	label: string;
	onClick?: () => void;
	custom?: HTMLElement; // arbitrary element (e.g. the tabbed panel), appended as-is
};

let currentPopoverAnchor: HTMLElement | null = null;
let currentDocClickHandler: ((ev: MouseEvent) => void) | null = null;
let currentPop: HTMLElement | null = null;
let activePanelRerender: (() => void) | null = null;

export function closePopover(): void {
	els().popoverRoot.innerHTML = "";
	currentPopoverAnchor = null;
	currentPop = null;
	activePanelRerender = null;
	if (currentDocClickHandler) {
		document.removeEventListener("mousedown", currentDocClickHandler);
		currentDocClickHandler = null;
	}
}

/** Re-render the open popover's active tab in place (no reposition, no tab
 *  reset). Called when async state (new model's thinking levels, the model
 *  list) lands so the panel reflects it without the user reopening it. */
export function refreshPopover(): void {
	if (activePanelRerender) activePanelRerender();
}

function showPopover(anchor: HTMLElement, options: PickerOption[]): void {
	// Toggle off if the same picker is clicked again while its popover is open.
	const wasOpen = currentPopoverAnchor === anchor;
	closePopover();
	if (wasOpen) return;
	currentPopoverAnchor = anchor;
	const rect = anchor.getBoundingClientRect();
	const pop = document.createElement("div");
	pop.className = "popover";
	currentPop = pop;
	for (const opt of options) {
		if (opt.custom) {
			pop.appendChild(opt.custom);
			continue;
		}
		const row = document.createElement("button");
		row.className = "popover-item";
		row.textContent = opt.label;
		row.addEventListener("click", (ev) => {
			ev.stopPropagation();
			closePopover();
			opt.onClick?.();
		});
		pop.appendChild(row);
	}
	if (!pop.hasChildNodes()) {
		closePopover();
		return;
	}
	els().popoverRoot.appendChild(pop);
	// Horizontal: align to the anchor's left, clamped so it doesn't overflow.
	const margin = 8;
	const popW = pop.getBoundingClientRect().width;
	let left = rect.left;
	if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin;
	if (left < margin) left = margin;
	pop.style.left = `${left}px`;
	// Vertical: drop below when the anchor is in the top half, else stack above.
	const placeBelow = rect.top < window.innerHeight / 2;
	if (placeBelow) pop.style.top = `${rect.bottom + 4}px`;
	else pop.style.bottom = `${window.innerHeight - rect.top + 4}px`;
	// Defer listener install so the opening click doesn't immediately close it.
	setTimeout(() => {
		const onDocClick = (mouseEv: MouseEvent) => {
			if (pop.contains(mouseEv.target as Node)) return;
			if (anchor.contains(mouseEv.target as Node)) return;
			closePopover();
		};
		currentDocClickHandler = onDocClick;
		document.addEventListener("mousedown", onDocClick);
	}, 0);
}

/** Update the mode-color CSS var on the mode picker chip. */
export function updateModeColor(): void {
	const e = els();
	e.pickerMode.style.setProperty("--mode-color", MODE_COLORS[ui.mode] ?? "var(--vscode-foreground)");
	// Keep the mode-button glyph in sync with the active mode. updateModeColor is
	// already called from every mode-change site (status dispatch, Tab cycle,
	// popover selection, boot), so the icon updates without extra wiring.
	e.pickerModeIcon.innerHTML = MODE_ICON[ui.mode] ?? "";
	updateModeChipTitle();
}

// ── Mode chip hover tooltip ──────────────────────────────────────────────────
// Custom card instead of a native `title` attribute: the OS tooltip has a long
// show delay, skips entirely after a recent click, and can't be styled — which
// read as "sometimes it just doesn't appear". Content is built from ui.* at
// hover time (always current) and live-refreshed if a status lands while open.

let modeTipEl: HTMLElement | null = null;
let modeTipTimer: ReturnType<typeof setTimeout> | undefined;

function buildModeTipContent(tip: HTMLElement): void {
	tip.innerHTML = "";
	tip.style.setProperty("--mode-color", MODE_COLORS[ui.mode] ?? "var(--vscode-foreground)");
	const modeRow = document.createElement("div");
	modeRow.className = "mode-tip-mode";
	modeRow.textContent = ui.mode;
	tip.appendChild(modeRow);
	const row = (label: string, value: string): void => {
		const r = document.createElement("div");
		r.className = "mode-tip-row";
		const l = document.createElement("span");
		l.className = "mode-tip-label";
		l.textContent = label;
		const v = document.createElement("span");
		v.className = "mode-tip-value";
		v.textContent = value;
		r.append(l, v);
		tip.appendChild(r);
	};
	row(t("chat.tab.model"), ui.model && ui.model !== "?" ? ui.model : "—");
	if (ui.thinking && ui.thinking !== "?") row(t("chat.picker.effort"), ui.thinking);
}

function positionModeTip(tip: HTMLElement): void {
	const rect = els().pickerMode.getBoundingClientRect();
	const margin = 8;
	const w = tip.getBoundingClientRect().width;
	let left = rect.right - w; // right-align to the chip
	if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin;
	if (left < margin) left = margin;
	tip.style.left = `${left}px`;
	tip.style.bottom = `${window.innerHeight - rect.top + 6}px`;
}

function showModeTip(): void {
	if (currentPopoverAnchor) return; // popover open — its panel already shows all this
	hideModeTip();
	const tip = document.createElement("div");
	tip.className = "mode-tip";
	buildModeTipContent(tip);
	els().popoverRoot.appendChild(tip); // reuse the popover layer (z-index)
	modeTipEl = tip;
	positionModeTip(tip);
}

function hideModeTip(): void {
	clearTimeout(modeTipTimer);
	modeTipTimer = undefined;
	modeTipEl?.remove();
	modeTipEl = null;
}

/** Live-refresh the open tooltip when a MODE/MODEL/THINKING status lands
 *  (called from dispatch + updateModeColor). No-op while not hovering. */
export function updateModeChipTitle(): void {
	if (!modeTipEl) return;
	buildModeTipContent(modeTipEl);
	positionModeTip(modeTipEl);
}

/** Wire the mode picker click + hover-tooltip handlers. Call once at boot. */
export function wirePickers(): void {
	const e = els();
	e.pickerMode.addEventListener("click", () => {
		hideModeTip(); // the popover supersedes the hover card
		// Pull the model list eagerly so the Model tab is populated when opened.
		if (ui.availableModels.length === 0) post({ kind: FROM_WEBVIEW.REQUEST_MODELS });
		const panel = buildPanel();
		showPopover(e.pickerMode, [{ label: "", custom: panel.el }]);
		if (currentPopoverAnchor === e.pickerMode) {
			activePanelRerender = panel.rerender;
			panel.lockHeight(); // measure now that it's laid out in the DOM
		} else {
			activePanelRerender = null;
		}
	});
	// Small enter-delay so brushing past the chip doesn't flash the card.
	e.pickerMode.addEventListener("mouseenter", () => {
		clearTimeout(modeTipTimer);
		modeTipTimer = setTimeout(showModeTip, 150);
	});
	e.pickerMode.addEventListener("mouseleave", hideModeTip);
}

// ── Tabbed Mode/Model panel ──────────────────────────────────────────────────

const svg = (body: string): string =>
	`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** Per-mode glyphs (Feather-style line icons). */
const MODE_ICON: Record<string, string> = {
	code: svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
	plan: svg(
		'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
	),
	debug: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
	ask: svg(
		'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
	),
	review: svg(
		'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
	),
};

function divider(): HTMLElement {
	const hr = document.createElement("div");
	hr.className = "popover-divider";
	return hr;
}

function selRow(opts: {
	icon?: string;
	label: string;
	sublabel?: string;
	selected: boolean;
	onClick: () => void;
}): HTMLButtonElement {
	const row = document.createElement("button");
	row.className = "popover-item" + (opts.selected ? " selected" : "");
	if (opts.icon) {
		const ic = document.createElement("span");
		ic.className = "popover-icon";
		ic.innerHTML = opts.icon;
		row.appendChild(ic);
	}
	const text = document.createElement("span");
	text.className = "popover-text";
	const main = document.createElement("span");
	main.className = "popover-label";
	main.textContent = opts.label;
	text.appendChild(main);
	if (opts.sublabel) {
		const sub = document.createElement("span");
		sub.className = "popover-sub";
		sub.textContent = opts.sublabel;
		text.appendChild(sub);
	}
	row.appendChild(text);
	row.addEventListener("click", (ev) => {
		ev.stopPropagation();
		opts.onClick();
	});
	return row;
}

/** A toggle row whose switch flips in place (so the slide transition plays). */
function toggleRow(label: string, on: boolean, onToggle: (sw: HTMLElement) => void): HTMLButtonElement {
	const row = document.createElement("button");
	row.className = "popover-item toggle";
	const text = document.createElement("span");
	text.className = "popover-text";
	const main = document.createElement("span");
	main.className = "popover-label";
	main.textContent = label;
	text.appendChild(main);
	row.appendChild(text);
	const sw = document.createElement("span");
	sw.className = "mini-switch" + (on ? " on" : "");
	const thumb = document.createElement("span");
	thumb.className = "mini-thumb";
	sw.appendChild(thumb);
	row.appendChild(sw);
	row.addEventListener("click", (ev) => {
		ev.stopPropagation();
		onToggle(sw);
	});
	return row;
}

function buildPanel(): { el: HTMLElement; rerender: () => void; lockHeight: () => void } {
	let active: "mode" | "model" = "mode";
	const el = document.createElement("div");
	el.className = "tab-panel-pop";
	const rail = document.createElement("div");
	rail.className = "tab-rail";
	const body = document.createElement("div");
	body.className = "tab-body";

	const railBtns = new Map<string, HTMLButtonElement>();
	(["mode", "model"] as const).forEach((key) => {
		const b = document.createElement("button");
		b.className = "tab-btn";
		b.textContent = t(`chat.tab.${key}`);
		b.addEventListener("click", (ev) => {
			ev.stopPropagation();
			active = key;
			syncRail();
			renderBody();
		});
		rail.appendChild(b);
		railBtns.set(key, b);
	});
	const syncRail = (): void => railBtns.forEach((b, k) => b.classList.toggle("active", k === active));
	const renderBody = (): void => {
		body.replaceChildren();
		if (active === "mode") renderModeBody(body, renderBody);
		else renderModelBody(body, renderBody);
	};

	syncRail();
	renderBody();
	// Tabs sit on the RIGHT (body first, rail second).
	el.append(body, rail);
	// Pin the body to the Mode tab's natural height so switching to the Model
	// tab keeps the popover the same height — models scroll, Effort stays pinned.
	const lockHeight = (): void => {
		if (active === "mode" && !body.style.height) body.style.height = `${body.offsetHeight}px`;
	};
	return { el, rerender: renderBody, lockHeight };
}

function renderModeBody(body: HTMLElement, rerender: () => void): void {
	for (const name of MODE_NAMES) {
		body.appendChild(
			selRow({
				icon: MODE_ICON[name],
				label: name,
				sublabel: t(`chat.mode.desc.${name}`),
				selected: name === ui.mode,
				onClick: () => {
					// Already in this mode → no-op. Sending /mode for the active mode
					// makes Pi emit "Already in X mode", which we don't want to surface.
					if (name === ui.mode) return;
					// No mode switching mid-turn: the running loop captured its
					// model/tools/prompt at start, so the switch wouldn't apply to it —
					// while the permission layer WOULD flip immediately, leaving the
					// loop in a mismatched hybrid. Same guard as Tab-cycle and slash.
					if (runtime.turnInFlight || runtime.compacting) return;
					// Optimistic: update chip label + color + checkmark together so
					// there's no visible lag waiting for Pi's status round-trip.
					ui.mode = name;
					els().pickerModeLabel.textContent = name;
					updateModeColor();
					post({ kind: FROM_WEBVIEW.PROMPT, text: `/mode ${name}` });
					rerender();
				},
			}),
		);
	}
	body.appendChild(divider());
	body.appendChild(
		toggleRow(t("chat.autoApproveLabel"), ui.autoApprove, (sw) => {
			ui.autoApprove = !ui.autoApprove; // optimistic
			post({ kind: FROM_WEBVIEW.SLASH, text: "/auto-approve" });
			sw.classList.toggle("on");
		}),
	);
}

function renderModelBody(body: HTMLElement, rerender: () => void): void {
	const curId = ui.modelId;
	const curProvider = ui.modelProvider;
	// Only the model list scrolls; the Effort slider is pinned at the bottom.
	const list = document.createElement("div");
	list.className = "model-list";
	let selectedRow: HTMLElement | null = null;
	if (ui.availableModels.length === 0) {
		const note = document.createElement("div");
		note.className = "popover-note";
		note.textContent = t("chat.loadingModels");
		list.appendChild(note);
	} else {
		for (const m of ui.availableModels) {
			const alias = (m as { alias?: string }).alias;
			const label = alias ?? m.id;
			const sublabel = alias ? `${m.id} · ${m.provider}` : m.provider;
			const selected = !!curId && curId === m.id && (!curProvider || curProvider === m.provider);
			const row = selRow({
				label,
				sublabel,
				selected,
				onClick: () => {
					ui.modelId = m.id; // optimistic — checkmark moves immediately
					ui.modelProvider = m.provider;
					post({
						kind: FROM_WEBVIEW.COMMAND,
						command: { type: "set_model", provider: m.provider, modelId: m.id },
					});
					rerender();
				},
			});
			if (selected) selectedRow = row;
			list.appendChild(row);
		}
	}
	body.appendChild(list);
	const effort = buildEffortBar();
	if (effort) {
		const footer = document.createElement("div");
		footer.className = "effort-footer";
		footer.appendChild(divider());
		footer.appendChild(effort);
		body.appendChild(footer);
	}
	// Bring the current model into view within the scrollable list.
	selectedRow?.scrollIntoView({ block: "nearest" });
}

// ── Effort slider (thinking levels) ──────────────────────────────────────────

const DUMBBELL_SVG = svg(
	'<path d="M6.5 6.5l11 11"/><path d="M21 21l-1-1"/><path d="M3 3l1 1"/><path d="M18 22l4-4"/><path d="M2 6l4-4"/><path d="M3 10l7-7"/><path d="M14 21l7-7"/>',
);

/** Display name for a thinking level (xhigh → "Extra high"). */
const EFFORT_DISPLAY: Record<string, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
};

// Effort slider geometry (px): a rail of width SPAN with KNOB_R padding.
const KNOB_R = 7;
const SPAN = 82;

/** A discrete "Effort" slider: a labeled rail with a knob that slides (CSS
 *  transition) to the clicked step. Binary models (qwen/zai) collapse to
 *  off/on. Returns null when the model exposes no thinking. */
function buildEffortBar(): HTMLElement | null {
	const levels = (ui.availableThinking.length > 0 ? ui.availableThinking : [...THINKING_LEVELS]).filter(
		(l) => l !== "",
	);
	if (levels.length === 0) return null;
	const n = levels.length;
	const xpx = (i: number): number => KNOB_R + (n === 1 ? 0 : (i / (n - 1)) * SPAN);
	const disp = (lvl: string): string =>
		ui.thinkingBinary ? (lvl === "off" ? "Off" : "On") : (EFFORT_DISPLAY[lvl] ?? lvl);

	const wrap = document.createElement("div");
	wrap.className = "effort-bar";

	const icon = document.createElement("span");
	icon.className = "effort-icon";
	icon.innerHTML = DUMBBELL_SVG;

	const label = document.createElement("span");
	label.className = "effort-label";
	label.textContent = t("chat.picker.effort") + " ";
	const val = document.createElement("span");
	val.className = "effort-value";
	label.appendChild(val);

	const track = document.createElement("div");
	track.className = "effort-track";
	track.style.width = `${KNOB_R * 2 + SPAN}px`;
	const rail = document.createElement("div");
	rail.className = "effort-rail";
	rail.style.left = `${KNOB_R}px`;
	rail.style.width = `${SPAN}px`;
	track.appendChild(rail);

	const knob = document.createElement("div");
	knob.className = "effort-knob";

	const place = (i: number, lvl: string): void => {
		knob.style.left = `${xpx(i)}px`;
		val.textContent = `(${disp(lvl)})`;
	};

	levels.forEach((lvl, i) => {
		const step = document.createElement("button");
		step.className = "effort-step";
		step.style.left = `${xpx(i)}px`;
		step.title = ui.thinkingBinary && lvl !== "off" ? "on" : lvl;
		step.addEventListener("click", (ev) => {
			ev.stopPropagation();
			ui.thinking = lvl; // optimistic
			place(i, lvl); // knob slides via CSS transition
			post({ kind: FROM_WEBVIEW.COMMAND, command: { type: "set_thinking_level", level: lvl } });
		});
		track.appendChild(step);
	});
	track.appendChild(knob);

	const curIdx = Math.max(0, levels.indexOf(ui.thinking));
	place(curIdx, levels[curIdx]);

	wrap.append(icon, label, track);
	return wrap;
}
