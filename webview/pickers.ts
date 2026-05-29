// Mode / Model / Thinking dropdown popovers. Generic `openPicker` factory
// renders the popover anchored below the button and wires click-outside-to-close.

import { els } from "./dom";
import { FROM_WEBVIEW, MODE_COLORS, MODE_NAMES, THINKING_LEVELS } from "./protocol";
import { post, ui } from "./state";

type PickerOption = { label: string; sublabel?: string; selected?: boolean; onClick: () => void };

let currentPopoverAnchor: HTMLElement | null = null;
let currentDocClickHandler: ((ev: MouseEvent) => void) | null = null;

export function closePopover(): void {
	els().popoverRoot.innerHTML = "";
	currentPopoverAnchor = null;
	// Critical: detach the document listener too — leaving it around with
	// stale `pop` / `anchor` closures was causing the picker to silently
	// no-op on the second click after a selection.
	if (currentDocClickHandler) {
		document.removeEventListener("mousedown", currentDocClickHandler);
		currentDocClickHandler = null;
	}
}

export function showPopover(anchor: HTMLElement, options: PickerOption[]): void {
	// Toggle off if the same picker is clicked again while its popover is open.
	const wasOpen = currentPopoverAnchor === anchor;
	closePopover();
	if (wasOpen) return;
	const e = els();
	currentPopoverAnchor = anchor;
	if (options.length === 0) return;
	const rect = anchor.getBoundingClientRect();
	const pop = document.createElement("div");
	pop.className = "popover";
	options.forEach((opt) => {
		const row = document.createElement("button");
		row.className = "popover-item" + (opt.selected ? " selected" : "");
		const main = document.createElement("span");
		main.className = "popover-label";
		main.textContent = opt.label;
		row.appendChild(main);
		if (opt.sublabel) {
			const sub = document.createElement("span");
			sub.className = "popover-sub";
			sub.textContent = opt.sublabel;
			row.appendChild(sub);
		}
		row.addEventListener("click", (ev) => {
			ev.stopPropagation();
			closePopover();
			opt.onClick();
		});
		pop.appendChild(row);
	});
	e.popoverRoot.appendChild(pop);
	// Auto placement: if the anchor sits in the top half of the viewport,
	// drop the popover below it; otherwise stack above (default — keeps the
	// bottom prompt pickers anchored without overflowing off-screen).
	const placeBelow = rect.top < window.innerHeight / 2;
	pop.style.left = `${rect.left}px`;
	if (placeBelow) {
		pop.style.top = `${rect.bottom + 4}px`;
	} else {
		pop.style.bottom = `${window.innerHeight - rect.top + 4}px`;
	}
	pop.style.minWidth = `${Math.max(rect.width, 180)}px`;
	// Defer listener install so the click that opened the popover doesn't
	// immediately close it. closePopover() removes this via currentDocClickHandler.
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
	els().pickerMode.style.setProperty(
		"--mode-color",
		MODE_COLORS[ui.mode] ?? "var(--vscode-foreground)",
	);
}

/** Wire mode / model / thinking picker click handlers. Call once at boot. */
export function wirePickers(): void {
	const e = els();
	e.pickerMode.addEventListener("click", () => {
		showPopover(
			e.pickerMode,
			MODE_NAMES.map((name) => ({
				label: name,
				selected: name === ui.mode,
				onClick: () => post({ kind: FROM_WEBVIEW.PROMPT, text: `/mode ${name}` }),
			})),
		);
	});

	e.pickerModel.addEventListener("click", () => {
		if (ui.availableModels.length === 0) {
			post({ kind: FROM_WEBVIEW.REQUEST_MODELS });
			setTimeout(openModelPopover, 200);
			return;
		}
		openModelPopover();
	});

	e.pickerThinking.addEventListener("click", () => {
		const supported = ui.availableThinking.length > 0 ? ui.availableThinking : [...THINKING_LEVELS];
		showPopover(
			e.pickerThinking,
			supported.map((lvl) => ({
				// Binary models (qwen/zai) show off/on; the non-off entry is a real
				// level (e.g. "medium") sent as-is, just labeled "on".
				label: ui.thinkingBinary && lvl !== "off" ? "on" : lvl,
				selected: ui.thinkingBinary
					? lvl === "off"
						? ui.thinking === "off"
						: ui.thinking !== "off"
					: lvl === ui.thinking,
				onClick: () =>
					post({
						kind: FROM_WEBVIEW.COMMAND,
						command: { type: "set_thinking_level", level: lvl },
					}),
			})),
		);
	});
}

function openModelPopover(): void {
	// Compare raw id+provider, not the alias-aware display label (ui.model).
	const curId = ui.modelId;
	const curProvider = ui.modelProvider;
	showPopover(
		els().pickerModel,
		ui.availableModels.map((m) => {
			const alias = (m as { alias?: string }).alias;
			// When alias present: alias as label, "id · provider" as sublabel
			// (so the raw id stays discoverable). Otherwise fall back to id/provider.
			const label = alias ?? m.id;
			const sublabel = alias ? `${m.id} · ${m.provider}` : m.provider;
			return {
				label,
				sublabel,
				selected: !!curId && curId === m.id && (!curProvider || curProvider === m.provider),
				onClick: () =>
					post({
						kind: FROM_WEBVIEW.COMMAND,
						command: { type: "set_model", provider: m.provider, modelId: m.id },
					}),
			};
		}),
	);
}
