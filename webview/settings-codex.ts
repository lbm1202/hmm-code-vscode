import { el, t, post, esc } from "./settings-state";

// Codex usage (ChatGPT subscription limits). Read-only; the host hits the
// usage endpoint with the stored OAuth token. Auto-fetched once per panel
// load when Codex is authed; the button re-fetches.
export function requestCodexUsage() {
	const out = el('codex-usage');
	if (out) { out.classList.remove('hidden'); out.textContent = t('settings.usage.checking'); }
	post({ kind: 'codex-usage' });
}
(function wireCodexUsage() {
	const btn = el('codex-usage-btn');
	if (btn) btn.addEventListener('click', requestCodexUsage);
})();
function fmtResetIn(resetAtSec: any) {
	const secs = Math.max(0, Math.round(resetAtSec - Date.now() / 1000));
	const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
	const parts = d ? [d + 'd', h + 'h'] : h ? [h + 'h', m + 'm'] : [m + 'm'];
	return t('settings.usage.resetsIn', { t: parts.join(' ') });
}
function windowLabel(win: any) {
	if (win.windowSeconds === 18000) return t('settings.usage.5h');
	if (win.windowSeconds === 604800) return t('settings.usage.weekly');
	return Math.round(win.windowSeconds / 3600) + 'h';
}
export function renderCodexUsage(msg: any) {
	const out = el('codex-usage');
	if (!out) return;
	out.classList.remove('hidden');
	if (msg.error) {
		out.textContent = t('settings.usage.failed', { err: msg.error });
		return;
	}
	const u = msg.usage || {};
	const wins = [u.primary, u.secondary].filter(Boolean);
	const rows = wins.map((w) =>
		'<div class="codex-usage-row"><span class="cu-label">' + esc(windowLabel(w)) + '</span>' +
		'<span class="cu-bar"><span class="cu-bar-fill" style="width:' + Math.min(100, Math.max(0, w.usedPercent)) + '%"></span></span>' +
		'<span class="cu-pct">' + esc(String(w.usedPercent)) + '%</span>' +
		'<span class="cu-reset">' + esc(fmtResetIn(w.resetAt)) + '</span></div>'
	).join('');
	const head = t('settings.usage.plan', { plan: u.planType || '?' }) + (u.limitReached ? ' · ' + t('settings.usage.limitReached') : '');
	out.innerHTML = '<div class="codex-usage-head">' + esc(head) + '</div>' + rows;
}
