// First-run onboarding card, rendered inside the empty state. Driven entirely
// by ONBOARDING messages from the host (which owns detection, the OAuth flow,
// and the mode presets) — this module only renders the three states and posts
// button intents back:
//   unauthed → login CTAs + how-it-works tips (+ error line after a failure)
//   login    → CTAs disabled, spinner status line, cancel
//   ready    → connected badge + applied presets + starter prompts + dismiss

import { appendSystem, els } from "./dom";
import { t } from "./i18n";
import { FROM_WEBVIEW, MODE_COLORS } from "./protocol";
import { post } from "./state";

interface ObMsg {
	state: "none" | "unauthed" | "login" | "ready";
	provider?: string;
	message?: string;
	error?: string;
	/** Ready state: current per-mode default model ids ("" = unset). */
	modeModels?: Record<string, string>;
}

const PROVIDER_LABEL: Record<string, string> = {
	anthropic: "Claude Pro/Max",
	"openai-codex": "ChatGPT (Codex)",
};

function div(className: string, text?: string): HTMLElement {
	const d = document.createElement("div");
	d.className = className;
	if (text !== undefined) d.textContent = text;
	return d;
}

function ctaButton(icon: string, label: string, note: string, onClick: () => void, opts?: { primary?: boolean; disabled?: boolean }): HTMLElement {
	const b = document.createElement("button");
	b.className = "ob-btn" + (opts?.primary ? " primary" : "") + (opts?.disabled ? " busy" : "");
	if (opts?.disabled) b.disabled = true;
	const i = document.createElement("span");
	i.className = "ob-bi";
	i.textContent = icon;
	const l = document.createElement("span");
	l.textContent = label;
	const n = document.createElement("span");
	n.className = "ob-note";
	n.textContent = note;
	b.append(i, l, n);
	b.addEventListener("click", onClick);
	return b;
}

function tipsBlock(): HTMLElement {
	const wrap = div("ob-tips");
	wrap.appendChild(div("ob-tips-h", t("ob.tipsHead")));
	const tip = (key: string, text: string): void => {
		const row = div("ob-tip");
		const k = document.createElement("span");
		k.className = "ob-k";
		k.textContent = key;
		const s = document.createElement("span");
		s.textContent = text;
		row.append(k, s);
		wrap.appendChild(row);
	};
	tip("Tab", t("ob.tipModes"));
	tip("Enter", t("ob.tipSteer"));
	tip("％", t("ob.tipButtons"));
	return wrap;
}

function loginButtons(disabled: boolean): HTMLElement[] {
	return [
		ctaButton("◆", t("ob.loginClaude"), t("ob.browserNote"), () => post({ kind: FROM_WEBVIEW.OB_LOGIN, provider: "anthropic" }), { primary: true, disabled }),
		ctaButton("◇", t("ob.loginCodex"), t("ob.browserNote"), () => post({ kind: FROM_WEBVIEW.OB_LOGIN, provider: "openai-codex" }), { disabled }),
		ctaButton("⚿", t("ob.apiKey"), t("ob.settingsNote"), () => post({ kind: FROM_WEBVIEW.OPEN_SETTINGS }), { disabled }),
	];
}

/** Ready state: the ACTUAL per-mode default models from modes.json — whether
 *  the login preset just wrote them or they were already configured. */
function modeModelsBlock(modeModels: Record<string, string>): HTMLElement {
	const wrap = div("ob-preset");
	wrap.appendChild(div("ob-preset-h", t("ob.presetHead")));
	for (const [name, id] of Object.entries(modeModels)) {
		const row = div("ob-preset-row");
		const mode = document.createElement("span");
		mode.className = "ob-preset-modes";
		mode.textContent = name;
		mode.style.color = (MODE_COLORS as Record<string, string>)[name] ?? "inherit";
		mode.style.fontWeight = "600";
		const model = document.createElement("span");
		model.className = "ob-preset-model" + (id ? "" : " unset");
		model.textContent = id || "—";
		row.append(mode, model);
		wrap.appendChild(row);
	}
	return wrap;
}

function dismissFoot(): HTMLElement {
	const foot = div("ob-foot");
	const a = document.createElement("a");
	a.className = "ob-link";
	a.textContent = t("ob.dismiss");
	a.addEventListener("click", () => {
		post({ kind: FROM_WEBVIEW.OB_DISMISS });
		root()?.classList.add("hidden");
	});
	foot.appendChild(a);
	return foot;
}

function root(): HTMLElement | null {
	return document.getElementById("onboarding-root");
}

// The card lives inside the empty state, which hides whenever the (auto-
// resumed) session has messages — so an unauthed veteran would never see it.
// dispatch calls this after history renders: drop a one-line pointer into the
// chat instead. Once per unauthed episode.
let currentState: ObMsg["state"] = "none";
let hiddenNoticed = false;

export function obNotifyIfHidden(): void {
	if (currentState !== "unauthed" || hiddenNoticed) return;
	if (!els().messages.hasChildNodes()) return; // empty state visible — card is on screen
	hiddenNoticed = true;
	appendSystem(t("ob.hiddenNotice"));
}

export function renderOnboarding(msg: ObMsg): void {
	currentState = msg.state;
	if (msg.state !== "unauthed") hiddenNoticed = false;
	const el = root();
	if (!el) return;
	if (msg.state === "none") {
		el.classList.add("hidden");
		el.innerHTML = "";
		return;
	}
	obNotifyIfHidden();
	el.classList.remove("hidden");
	el.innerHTML = "";
	const card = div("ob-card");

	if (msg.state === "unauthed" || msg.state === "login") {
		card.appendChild(div("ob-title", t("ob.title")));
		if (msg.state === "login") {
			const status = div("ob-status busy");
			const spin = document.createElement("span");
			spin.className = "ob-spin";
			const text = document.createElement("span");
			text.textContent = msg.message ?? "…";
			const cancel = document.createElement("a");
			cancel.className = "ob-link ob-cancel";
			cancel.textContent = t("settings.cancel");
			cancel.addEventListener("click", () => post({ kind: FROM_WEBVIEW.OB_LOGIN_CANCEL }));
			status.append(spin, text, cancel);
			card.appendChild(status);
		} else {
			card.appendChild(div("ob-desc", t("ob.desc")));
			if (msg.error) card.appendChild(div("ob-status err", "✗ " + msg.error));
		}
		for (const b of loginButtons(msg.state === "login")) card.appendChild(b);
		card.appendChild(tipsBlock());
	} else {
		// ready
		const label = PROVIDER_LABEL[msg.provider ?? ""] ?? msg.provider ?? "";
		card.appendChild(div("ob-status ok", "✓ " + t("ob.connected", { label })));
		card.appendChild(modeModelsBlock(msg.modeModels ?? {}));
		card.appendChild(
			ctaButton("⚙︎", t("ob.modeSettingsBtn"), t("ob.settingsNote"), () =>
				post({ kind: FROM_WEBVIEW.OPEN_SETTINGS }),
			),
		);
		card.appendChild(dismissFoot());
	}

	el.appendChild(card);
}
