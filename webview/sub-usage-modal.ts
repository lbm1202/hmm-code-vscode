// Subscription plan-usage modal, opened by the topbar 📊 button. Asks the host
// for every connected subscription's usage (Claude Pro/Max, ChatGPT Codex) and
// renders each as ctx-gauge bars — the same visual language as the token modal.
// The request is async: the modal opens with a "checking…" body and
// renderSubUsage() fills it when SUB_USAGE arrives (stale replies are dropped
// once the modal has been closed or reopened).

import { els } from "./dom";
import { t } from "./i18n";
import { FROM_WEBVIEW } from "./protocol";
import { post } from "./state";

let bodyEl: HTMLElement | null = null;
let openToken = 0;

function resetLabel(epoch: number): string {
	if (!epoch) return "";
	const when = new Date(epoch * 1000).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	return t("settings.usage.resetsAt", { when });
}

function gauge(label: string, pct: number, right: string): HTMLElement {
	const p = Math.max(0, Math.min(100, Math.round(pct)));
	const wrap = document.createElement("div");
	wrap.className = "ctx-gauge";
	const lab = document.createElement("div");
	lab.className = "ctx-gauge-label";
	const left = document.createElement("span");
	left.textContent = label;
	const rightEl = document.createElement("span");
	rightEl.className = "ctx-gauge-nums";
	rightEl.textContent = right ? `${p}% · ${right}` : `${p}%`;
	lab.append(left, rightEl);
	const track = document.createElement("div");
	track.className = "ctx-gauge-track";
	const fill = document.createElement("div");
	fill.className = "ctx-gauge-fill";
	fill.classList.add(p >= 90 ? "danger" : p >= 70 ? "warn" : "ok");
	fill.style.width = `${p}%`;
	track.appendChild(fill);
	wrap.append(lab, track);
	return wrap;
}

function sectionHead(text: string): HTMLElement {
	const head = document.createElement("div");
	head.className = "sub-usage-head";
	head.textContent = text;
	return head;
}

function noteLine(text: string): HTMLElement {
	const div = document.createElement("div");
	div.className = "modal-context";
	div.textContent = text;
	return div;
}

function codexWindowLabel(windowSeconds: number): string {
	if (windowSeconds === 18000) return t("settings.usage.5h");
	if (windowSeconds === 604800) return t("settings.usage.weekly");
	return `${Math.round(windowSeconds / 3600)}h`;
}

/** Fill the open modal from the host's SUB_USAGE reply. No-op if the modal
 *  was closed (or reopened) since the request went out. */
export function renderSubUsage(msg: any): void {
	const body = bodyEl;
	if (!body || Number(msg?.token) !== openToken) return;
	body.innerHTML = "";
	const entries: any[] = Array.isArray(msg?.entries) ? msg.entries : [];
	if (entries.length === 0) {
		body.appendChild(noteLine(t("chat.usage.none")));
		return;
	}
	for (const e of entries) {
		if (e.provider === "anthropic") {
			body.appendChild(sectionHead(t("chat.usage.claude")));
			if (e.error || !e.usage) {
				body.appendChild(noteLine(`${t("settings.usage.failed")}${e.error ? " — " + e.error : ""}`));
				continue;
			}
			for (const w of e.usage.windows ?? []) {
				const label = w.kind === "session" ? t("settings.usage.5h") : t("settings.usage.weekly");
				body.appendChild(gauge(label, Number(w.usedPercent) || 0, resetLabel(Number(w.resetAt) || 0)));
			}
			const extra = e.usage.extra;
			if (extra?.enabled) {
				body.appendChild(
					gauge(t("settings.usage.extra"), Number(extra.usedPercent) || 0, `${extra.currency || "USD"} ${extra.limitAmount ?? ""}`),
				);
			}
		} else if (e.provider === "openai-codex") {
			const head = t("chat.usage.codex");
			const plan = e.codex?.planType ? ` · ${t("settings.usage.plan", { plan: e.codex.planType })}` : "";
			const limit = e.codex?.limitReached ? ` · ${t("settings.usage.limitReached")}` : "";
			body.appendChild(sectionHead(head + plan + limit));
			if (e.error || !e.codex) {
				body.appendChild(noteLine(`${t("settings.usage.failed")}${e.error ? " — " + e.error : ""}`));
				continue;
			}
			for (const w of [e.codex.primary, e.codex.secondary]) {
				if (!w) continue;
				body.appendChild(
					gauge(codexWindowLabel(Number(w.windowSeconds) || 0), Number(w.usedPercent) || 0, resetLabel(Number(w.resetAt) || 0)),
				);
			}
		}
	}
}

/** Open the modal (shell + "checking…") and ask the host for fresh usage. */
export function openSubUsageModal(): void {
	const modalRoot = els().modalRoot;
	openToken++;

	const backdrop = document.createElement("div");
	backdrop.className = "modal-backdrop";
	const modal = document.createElement("div");
	modal.className = "modal sub-usage-modal";

	const title = document.createElement("div");
	title.className = "modal-prompt";
	title.textContent = t("chat.usage.title");
	modal.appendChild(title);

	const body = document.createElement("div");
	body.className = "sub-usage-body";
	body.appendChild(noteLine(t("settings.usage.checking")));
	modal.appendChild(body);
	bodyEl = body;

	const row = document.createElement("div");
	row.className = "modal-row";
	const close = document.createElement("button");
	close.className = "ghost";
	close.textContent = t("settings.close");
	const dismiss = () => {
		bodyEl = null;
		modalRoot.innerHTML = "";
		document.removeEventListener("keydown", onKey, true);
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			dismiss();
		}
	};
	close.addEventListener("click", dismiss);
	backdrop.addEventListener("click", (e) => {
		if (e.target === backdrop) dismiss();
	});
	document.addEventListener("keydown", onKey, true);
	row.appendChild(close);
	modal.appendChild(row);

	backdrop.appendChild(modal);
	modalRoot.innerHTML = "";
	modalRoot.appendChild(backdrop);

	post({ kind: FROM_WEBVIEW.REQUEST_SUB_USAGE, token: openToken });
}
