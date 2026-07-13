// Claude (Anthropic subscription) usage display. Button-triggered: posts
// { kind: 'anthropic-usage' } to the host (src/anthropic-usage.ts does the
// fetch), then renders the result from the 'anthropic-usage-result' message
// (dispatched in settings.ts). Shows session (5h) + weekly windows with a %
// bar + reset time, plus extra-usage credits when enabled.
import { el, post, t, esc } from "./settings-state";

export function requestAnthropicUsage(): void {
	const out = el("anthropic-usage");
	if (out) {
		out.classList.remove("hidden");
		out.innerHTML = '<div class="oauth-usage-head">' + esc(t("settings.usage.checking")) + "</div>";
	}
	post({ kind: "anthropic-usage" });
}

// Wire the "check usage" button once at module load (the button HTML is emitted
// by the host; it starts hidden and is revealed by updateOAuthButtons when the
// Claude subscription is authenticated).
{
	const btn = el("anthropic-usage-btn");
	if (btn) btn.addEventListener("click", requestAnthropicUsage);
}

function windowLabel(kind: string): string {
	if (kind === "session") return t("settings.usage.5h");
	if (kind === "weekly") return t("settings.usage.weekly");
	return kind;
}

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

function bar(pct: number, label: string, right: string): string {
	const p = Math.max(0, Math.min(100, Math.round(pct)));
	return (
		'<div class="oauth-usage-row">' +
		'<span class="cu-label">' + esc(label) + "</span>" +
		'<span class="cu-bar"><span class="cu-bar-fill" style="width:' + p + '%"></span></span>' +
		'<span class="cu-pct">' + p + "%</span>" +
		'<span class="cu-reset">' + esc(right) + "</span>" +
		"</div>"
	);
}

export function renderAnthropicUsage(msg: any): void {
	const out = el("anthropic-usage");
	if (!out) return;
	out.classList.remove("hidden");
	if (msg.error || !msg.usage) {
		out.innerHTML =
			'<div class="oauth-usage-head">' +
			esc(t("settings.usage.failed")) +
			(msg.error ? " — " + esc(String(msg.error)) : "") +
			"</div>";
		return;
	}
	const u = msg.usage;
	let rows = (u.windows || [])
		.map((w: any) => bar(Number(w.usedPercent) || 0, windowLabel(String(w.kind)), resetLabel(Number(w.resetAt) || 0)))
		.join("");
	if (u.extra && u.extra.enabled) {
		rows += bar(
			Number(u.extra.usedPercent) || 0,
			t("settings.usage.extra"),
			String(u.extra.currency || "USD") + " " + String(u.extra.limitAmount ?? ""),
		);
	}
	out.innerHTML = '<div class="oauth-usage-head">' + esc(t("settings.usage.head")) + "</div>" + rows;
}
