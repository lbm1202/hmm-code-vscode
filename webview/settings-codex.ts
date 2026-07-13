// Codex (ChatGPT subscription) usage display. Button-triggered: posts
// { kind: 'codex-usage' } to the host (src/codex-usage.ts does the fetch),
// then renders the result from the 'codex-usage-result' message (dispatched
// in settings.ts). Shows the 5h + weekly rate-limit windows with a % bar +
// reset time, headed by the plan name — same layout as the Claude block.
import { el, post, t, esc } from "./settings-state";

export function requestCodexUsage(): void {
	const out = el("codex-usage");
	if (out) {
		out.classList.remove("hidden");
		out.innerHTML = '<div class="oauth-usage-head">' + esc(t("settings.usage.checking")) + "</div>";
	}
	post({ kind: "codex-usage" });
}

// Wire the "check usage" button once at module load (the button HTML is emitted
// by the host; it starts hidden and is revealed by updateOAuthButtons when the
// Codex subscription is authenticated).
{
	const btn = el("codex-usage-btn");
	if (btn) btn.addEventListener("click", requestCodexUsage);
}

function windowLabel(windowSeconds: number): string {
	if (windowSeconds === 18000) return t("settings.usage.5h");
	if (windowSeconds === 604800) return t("settings.usage.weekly");
	return Math.round(windowSeconds / 3600) + "h";
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

export function renderCodexUsage(msg: any): void {
	const out = el("codex-usage");
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
	const rows = [u.primary, u.secondary]
		.filter(Boolean)
		.map((w: any) =>
			bar(Number(w.usedPercent) || 0, windowLabel(Number(w.windowSeconds) || 0), resetLabel(Number(w.resetAt) || 0)),
		)
		.join("");
	const head =
		t("settings.usage.plan", { plan: String(u.planType || "?") }) +
		(u.limitReached ? " · " + t("settings.usage.limitReached") : "");
	out.innerHTML = '<div class="oauth-usage-head">' + esc(head) + "</div>" + rows;
}
