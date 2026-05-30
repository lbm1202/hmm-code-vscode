// Settings-panel webview script. Extracted from the inline template strings
// that used to live in src/settings-panel.ts, loaded as a bundled asset via
// <script src>. TypeScript (bundled by esbuild to out/webview/settings.js).
//
// DOM access is intentionally loosely typed: el()/q()/qa() return `any` so the
// (very DOM-heavy) panel code stays terse. TS still fully checks module state +
// function references — which is what makes the file safe to refactor/split.
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

export const vscode = acquireVsCodeApi();
export const post = (msg: unknown): void => vscode.postMessage(msg);
export const I18N: Record<string, string> = (window as any).__HMM_I18N || {};
export function t(key: string, params?: Record<string, unknown>): string {
	let str = I18N[key] != null ? I18N[key] : key;
	if (params) str = str.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : '{' + k + '}'));
	return str;
}

// Permissive DOM accessors — identical runtime to the native calls; `any`
// return keeps DOM-touching code terse without weakening state/ref checks.
export const el = (id: string): any => document.getElementById(id);
export const q = (root: any, sel: string): any => root.querySelector(sel);
export const qa = (root: any, sel: string): any[] => Array.from(root.querySelectorAll(sel));

export const MODE_NAMES = ["plan", "code", "debug", "ask"];
export const THINKING_LEVELS = ["", "off", "minimal", "low", "medium", "high", "xhigh"];
export const API_TYPES = ["openai-completions", "openai-responses", "anthropic-messages"];
export const API_TYPE_HTML = API_TYPES.map((t) => '<option value="' + t + '">' + t + '</option>').join('');
// All mutable panel state in one object so it can be shared across modules
// (ES module `let` exports are read-only for importers; object props are not).
export const S = {
	diskState: null as any,
	modesDraft: {} as any,
	autoTitleDraft: { provider: '', id: '' } as { provider: string; id: string },
	compactModelDraft: { provider: '', id: '' } as { provider: string; id: string },
	authAddsDraft: {} as Record<string, string>,       // provider id -> key (new)
	authRemovesDraft: new Set<string>(),                // provider ids to remove
	modelsDraft: { providers: {} } as any,
	allowlistDraft: {} as Record<string, string[]>,     // per-provider id allowlist
	compactDraft: '',               // auto-compact threshold (effective value)
	dynamicCompactionDraft: true,   // dynamic compaction toggle (default on)
	autoTitlePromptDraft: '',       // auto-title prompt override ('' = default)
	compactInstructionsDraft: '',   // compaction additional-focus ('' = none)
	codexUsageFetched: false,       // one-shot guard for the usage auto-fetch
};
// Per-provider model id allowlist draft. Empty obj or empty list per provider
// = no filter for that provider. Sent to host as modelAllowlist on save.

export function showToast(text: any, isError?: any) {
	const t = el('toast');
	t.textContent = text;
	t.classList.toggle('error', !!isError);
	t.classList.remove('hidden');
	setTimeout(() => t.classList.add('hidden'), 2500);
}
export function esc(s: any) {
	return String(s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
