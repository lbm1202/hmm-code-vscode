import { S, esc, t, MODE_NAMES, THINKING_LEVELS } from "./settings-state";
import { isModelAllowed } from "../src/model-utils";

export function buildProviderIndex(applyAllowlist = true) {
	// Map<provider, Array<{id, alias?}>>. Alias comes from modes.json:modelAliases
	// and is attached to availableModels by the host. Dropdowns display alias
	// when present so the user sees "Hmm" instead of "Qwen3.6-35B-A3B-MLX-VL-oQ5".
	//
	// applyAllowlist=true (default): respect the user's allowlist filter so
	// the mode/autoTitle dropdowns mirror what the chat picker shows. A mode
	// that's already configured to a now-hidden model keeps its selection —
	// combinedModelOptionsHtml re-injects the current key if it's missing.
	// applyAllowlist=false: used by the allowlist UI itself, which must list
	// every model so the user can toggle them.
	const map = new Map();
	const list = (S.diskState && S.diskState.availableModels) || [];
	for (const m of list) {
		if (!m.provider || !m.id) continue;
		if (!map.has(m.provider)) map.set(m.provider, []);
		map.get(m.provider).push({ id: m.id, alias: m.alias });
	}
	if (applyAllowlist) {
		for (const [prov, entries] of map.entries()) {
			// Same predicate the chat picker uses (src/model-utils) but against the
			// live draft allowlist so the dropdowns reflect unsaved edits.
			map.set(prov, entries.filter((e: any) => isModelAllowed(S.allowlistDraft, prov, e.id)));
		}
	}
	for (const arr of map.values())
		arr.sort((a: any, b: any) => (a.alias ?? a.id).localeCompare(b.alias ?? b.id));
	return map;
}

// Single-select model picker: every model grouped by provider (<optgroup>),
// so picking a model implies its provider — no separate provider dropdown.
// Option values encode "provider<US>id" (US = U+001F: ids can contain "/").
export const MODEL_KEY_SEP = "\u001f";

export function splitModelKey(v: any): { provider: string; id: string } {
	const s = String(v || "");
	const i = s.indexOf(MODEL_KEY_SEP);
	return i < 0 ? { provider: "", id: "" } : { provider: s.slice(0, i), id: s.slice(i + 1) };
}

export function combinedModelOptionsHtml(curProvider: any, curId: any, providerIndex: any) {
	const curKey = curProvider && curId ? curProvider + MODEL_KEY_SEP + curId : "";
	let curSeen = false;
	const parts = ['<option value="">(default)</option>'];
	for (const p of [...providerIndex.keys()].sort()) {
		const entries = providerIndex.get(p) || [];
		if (entries.length === 0) continue;
		const opts = [];
		for (const e of entries) {
			const key = p + MODEL_KEY_SEP + e.id;
			const sel = key === curKey ? " selected" : "";
			if (sel) curSeen = true;
			const label = e.alias || e.id;
			const title = (e.alias ? e.alias + " (" + e.id + ")" : e.id) + " — " + p;
			opts.push('<option value="' + esc(key) + '" title="' + esc(title) + '"' + sel + ">" + esc(label) + "</option>");
		}
		parts.push('<optgroup label="' + esc(p) + '">' + opts.join("") + "</optgroup>");
	}
	// Keep an unknown current selection selectable (model list not yet loaded,
	// allowlist-hidden, or a provider Pi doesn't know) — mirrors modelOptionsHtml.
	if (curKey && !curSeen) {
		parts.splice(1, 0, '<option value="' + esc(curKey) + '" selected>' + esc(curId + " — " + curProvider) + "</option>");
	}
	return parts.join("");
}

const BINARY_THINKING_FORMATS = ['qwen-chat-template', 'qwen', 'zai'];

export function findAvailableModel(provider: any, id: any) {
	const list = (S.diskState && S.diskState.availableModels) || [];
	return list.find((m: any) => m.provider === provider && m.id === id) || null;
}

// Thinking <option>s for a mode, mirroring the chat picker: non-reasoning →
// (default)+off; binary qwen/zai → (default)+off+on; leveled → (default)+off+
// mapped levels. `selected` is the mode's stored thinkingLevel ('' = default).
export function modeThinkingOptionsHtml(provider: any, id: any, selected: any) {
	const sel = selected || '';
	const opt = (val: any, label: any, on: any) => '<option value="' + esc(val) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>';
	let html = opt('', '(default)', sel === '');
	const model = findAvailableModel(provider, id);
	if (!model || !model.reasoning) return html + opt('off', 'off', sel === 'off');
	const map = model.thinkingLevelMap || {};
	if (model.thinkingFormat && BINARY_THINKING_FORMATS.includes(model.thinkingFormat)) {
		const onLevel = THINKING_LEVELS.find((l) => l && l !== 'off' && map[l] != null) || 'medium';
		return html + opt('off', 'off', sel === 'off') + opt(onLevel, 'on', sel !== '' && sel !== 'off');
	}
	for (const lvl of THINKING_LEVELS) {
		if (lvl === '') continue;
		const mapped = map[lvl];
		if (mapped === null) continue;
		if ((lvl === 'xhigh' || lvl === 'max') && mapped === undefined) continue;
		html += opt(lvl, lvl, sel === lvl);
	}
	return html;
}

const THINKING_FORMATS = ['openai', 'openrouter', 'deepseek', 'together', 'zai', 'qwen', 'qwen-chat-template', 'string-thinking'];

export function thinkingFormatOptionsHtml(selected: any) {
	const list = THINKING_FORMATS.slice();
	// Preserve an on-disk value we don't recognize so save can't silently drop it.
	if (selected && list.indexOf(selected) === -1) list.push(selected);
	let html = '<option value=""' + (!selected ? ' selected' : '') + '>(auto)</option>';
	for (const f of list) {
		html += '<option value="' + esc(f) + '"' + (f === selected ? ' selected' : '') + '>' + esc(f) + '</option>';
	}
	return html;
}
