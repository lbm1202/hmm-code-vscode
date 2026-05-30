// Settings-panel webview script. Extracted from the inline template strings
// that used to live in src/settings-panel.ts, loaded as a bundled asset via
// <script src>. TypeScript (bundled by esbuild to out/webview/settings.js).
//
// DOM access is intentionally loosely typed: el()/q()/qa() return `any` so the
// (very DOM-heavy) panel code stays terse. TS still fully checks module state +
// function references — which is what makes the file safe to refactor/split.
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const vscode = acquireVsCodeApi();
const post = (msg: unknown): void => vscode.postMessage(msg);
const I18N: Record<string, string> = (window as any).__HMM_I18N || {};
function t(key: string, params?: Record<string, unknown>): string {
	let str = I18N[key] != null ? I18N[key] : key;
	if (params) str = str.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : '{' + k + '}'));
	return str;
}

// Permissive DOM accessors — identical runtime to the native calls; `any`
// return keeps DOM-touching code terse without weakening state/ref checks.
const el = (id: string): any => document.getElementById(id);
const q = (root: any, sel: string): any => root.querySelector(sel);
const qa = (root: any, sel: string): any[] => Array.from(root.querySelectorAll(sel));

const MODE_NAMES = ["plan", "code", "debug", "ask"];
const THINKING_LEVELS = ["", "off", "minimal", "low", "medium", "high", "xhigh"];
const API_TYPES = ["openai-completions", "openai-responses", "anthropic-messages"];
const API_TYPE_HTML = API_TYPES.map((t) => '<option value="' + t + '">' + t + '</option>').join('');
let diskState: any = null;
let modesDraft: any = {};
let autoTitleDraft: { provider: string; id: string } = { provider: '', id: '' };
let compactModelDraft: { provider: string; id: string } = { provider: '', id: '' };  // compaction (summary) model override
let authAddsDraft: Record<string, string> = {};  // provider id -> key (new ones to add)
let authRemovesDraft = new Set<string>();         // provider ids to remove
let modelsDraft: any = { providers: {} };
// Per-provider model id allowlist draft. Empty obj or empty list per provider
// = no filter for that provider. Sent to host as modelAllowlist on save.
let allowlistDraft: Record<string, string[]> = {};
let compactDraft = '';  // auto-compact threshold (effective value shown in the input)
let dynamicCompactionDraft = true;  // dynamic compaction toggle (default on)
let autoTitlePromptDraft = '';  // auto-title system-prompt override ('' = built-in default)
let compactInstructionsDraft = '';  // compaction additional-focus ('' = none)

function showToast(text: any, isError?: any) {
	const t = el('toast');
	t.textContent = text;
	t.classList.toggle('error', !!isError);
	t.classList.remove('hidden');
	setTimeout(() => t.classList.add('hidden'), 2500);
}
function esc(s: any) {
	return String(s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function diskMode(name: any) {
	const cfg = (diskState && diskState.modes && diskState.modes.modes && diskState.modes.modes[name]) || {};
	const m = cfg.model;
	const isObj = m && typeof m === 'object';
	return {
		provider: isObj ? (m.provider || '') : '',
		id: isObj ? (m.id || '') : '',
		thinking: cfg.thinkingLevel || '',
		promptOverride: cfg.systemPromptAddendum || '',
	};
}
function defaultPrompt(name: any) {
	return (diskState && diskState.defaultPrompts && diskState.defaultPrompts[name]) || '';
}
function diskAuth() { return (diskState && diskState.auth) || {}; }
function diskModels() {
	const m = diskState && diskState.models;
	return (m && typeof m === 'object' && m.providers) ? m : { providers: {} };
}

function modeDirty(name: any) {
	const d = diskMode(name);
	const draft = modesDraft[name] || { provider: '', id: '', thinking: '', prompt: '' };
	const def = defaultPrompt(name);
	// Treat "prompt identical to default" as no override.
	const draftOverride = (draft.prompt || '') === def ? '' : (draft.prompt || '');
	return d.provider !== draft.provider || d.id !== draft.id || d.thinking !== draft.thinking
		|| draftOverride !== d.promptOverride;
}
function authDirty() {
	return Object.keys(authAddsDraft).length > 0 || authRemovesDraft.size > 0;
}
function modelsDirty() {
	return JSON.stringify(modelsDraft) !== JSON.stringify(diskModels());
}

function diskAutoTitle() {
	const a = diskState && diskState.modes && diskState.modes.autoTitle;
	return {
		provider: (a && a.provider) || '',
		id: (a && a.id) || '',
	};
}
function autoTitleDirty() {
	const d = diskAutoTitle();
	return d.provider !== autoTitleDraft.provider || d.id !== autoTitleDraft.id;
}
function diskCompactModel() {
	const a = diskState && diskState.modes && diskState.modes.compactModel;
	return {
		provider: (a && a.provider) || '',
		id: (a && a.id) || '',
	};
}
function compactModelDirty() {
	const d = diskCompactModel();
	return d.provider !== compactModelDraft.provider || d.id !== compactModelDraft.id;
}

function diskAllowlist() {
	const a = diskState && diskState.modelAllowlist;
	return (a && typeof a === 'object') ? a : {};
}
function allowlistDirty() {
	// Preserve empty arrays — they mean "explicitly hide all from this provider",
	// distinct from a missing key which means "no filter".
	const norm = (obj: any) => {
		const out: Record<string, any> = {};
		for (const [k, v] of Object.entries(obj || {})) {
			if (Array.isArray(v)) out[k] = v.slice().sort();
		}
		return out;
	};
	return JSON.stringify(norm(allowlistDraft)) !== JSON.stringify(norm(diskAllowlist()));
}

function diskCompactOverride() {
	return (diskState && typeof diskState.autoCompactThreshold === 'number') ? diskState.autoCompactThreshold : null;
}
function defaultCompact() {
	return (diskState && typeof diskState.defaultCompactThreshold === 'number') ? diskState.defaultCompactThreshold : 75;
}
function compactDirty() {
	// Treat "equal to default" as no override.
	const def = defaultCompact();
	const n = parseInt(compactDraft, 10);
	const draftOverride = (!Number.isFinite(n) || n === def) ? null : n;
	return draftOverride !== diskCompactOverride();
}
function diskDynamicCompaction() {
	return (diskState && typeof diskState.dynamicCompaction === 'boolean') ? diskState.dynamicCompaction : true;
}
function dynamicCompactionDirty() {
	return dynamicCompactionDraft !== diskDynamicCompaction();
}
function diskAutoTitlePrompt() {
	const v = diskState && diskState.modes && diskState.modes.autoTitlePrompt;
	return typeof v === 'string' ? v : '';
}
function defaultAutoTitle() {
	return (diskState && typeof diskState.defaultAutoTitlePrompt === 'string') ? diskState.defaultAutoTitlePrompt : '';
}
// The auto-title editor is pre-filled with the built-in default; an override is
// only stored when the text differs from it (mirrors the per-mode prompts).
function autoTitleOverrideFromDraft() {
	const d = autoTitlePromptDraft.trim();
	return (d === '' || d === defaultAutoTitle().trim()) ? '' : autoTitlePromptDraft;
}
function diskCompactInstructions() {
	const v = diskState && diskState.modes && diskState.modes.compactInstructions;
	return typeof v === 'string' ? v : '';
}
function autoTitlePromptDirty() {
	return autoTitleOverrideFromDraft().trim() !== diskAutoTitlePrompt().trim();
}
function compactInstructionsDirty() {
	return compactInstructionsDraft.trim() !== diskCompactInstructions().trim();
}

function isDirty() {
	if (!diskState) return false;
	for (const n of MODE_NAMES) if (modeDirty(n)) return true;
	if (autoTitleDirty()) return true;
	if (compactModelDirty()) return true;
	if (authDirty()) return true;
	if (modelsDirty()) return true;
	if (allowlistDirty()) return true;
	if (compactDirty()) return true;
	if (dynamicCompactionDirty()) return true;
	if (autoTitlePromptDirty()) return true;
	if (compactInstructionsDirty()) return true;
	return false;
}

function updateSaveBar() {
	const dirty = isDirty();
	el('save-bar').classList.toggle('hidden', !dirty);
	if (!dirty) return;
	let modeD = 0, authD = 0;
	for (const n of MODE_NAMES) if (modeDirty(n)) modeD++;
	authD = Object.keys(authAddsDraft).length + authRemovesDraft.size;
	const parts = [];
	if (modeD) parts.push(t('settings.dirty.modes', { n: modeD }));
	if (autoTitleDirty()) parts.push(t('settings.dirty.autoTitle'));
	if (compactModelDirty()) parts.push(t('settings.dirty.compactModel'));
	if (authD) parts.push(t('settings.dirty.auth', { n: authD }));
	if (modelsDirty()) parts.push(t('settings.dirty.providers'));
	if (allowlistDirty()) parts.push(t('settings.dirty.filter'));
	if (compactDirty()) parts.push(t('settings.dirty.compact'));
	el('dirty-detail').textContent = parts.length ? ' (' + parts.join(' · ') + ')' : '';
}

// Build a {provider: [id, ...]} index from live availableModels (cached from
// Pi's get_available_models). Used to constrain the mode dropdowns to real
// choices. Fallback: if Pi hasn't responded yet, both selects show only the
// current draft value so the user isn't blocked.
function buildProviderIndex(applyAllowlist = true) {
	// Map<provider, Array<{id, alias?}>>. Alias comes from modes.json:modelAliases
	// and is attached to availableModels by the host. Dropdowns display alias
	// when present so the user sees "Hmm" instead of "Qwen3.6-35B-A3B-MLX-VL-oQ5".
	//
	// applyAllowlist=true (default): respect the user's allowlist filter so
	// the mode/autoTitle dropdowns mirror what the chat picker shows. A mode
	// that's already configured to a now-hidden model keeps its selection —
	// modelOptionsHtml re-injects the currentValue if it's missing.
	// applyAllowlist=false: used by the allowlist UI itself, which must list
	// every model so the user can toggle them.
	const map = new Map();
	const list = (diskState && diskState.availableModels) || [];
	for (const m of list) {
		if (!m.provider || !m.id) continue;
		if (!map.has(m.provider)) map.set(m.provider, []);
		map.get(m.provider).push({ id: m.id, alias: m.alias });
	}
	if (applyAllowlist) {
		for (const [prov, entries] of map.entries()) {
			const allowed = Array.isArray(allowlistDraft[prov])
				? new Set(allowlistDraft[prov])
				: null;
			if (allowed) map.set(prov, entries.filter((e: any) => allowed.has(e.id)));
		}
	}
	for (const arr of map.values())
		arr.sort((a: any, b: any) => (a.alias ?? a.id).localeCompare(b.alias ?? b.id));
	return map;
}

function providerOptionsHtml(currentValue: any, providerIndex: any) {
	const opts = [...providerIndex.keys()].sort();
	// Ensure the current draft value is selectable even if Pi doesn't know
	// about it yet (e.g. user typed a provider name that hasn't been
	// registered or the get_available_models response hasn't arrived).
	if (currentValue && !providerIndex.has(currentValue)) opts.unshift(currentValue);
	const parts = ['<option value="">(default)</option>'];
	for (const p of opts) {
		const sel = p === currentValue ? ' selected' : '';
		parts.push('<option value="' + esc(p) + '"' + sel + '>' + esc(p) + '</option>');
	}
	return parts.join('');
}

function modelOptionsHtml(currentValue: any, provider: any, providerIndex: any) {
	const entries = (provider && providerIndex.get(provider)) || [];
	const present = entries.slice();
	if (currentValue && !present.some((e: any) => e.id === currentValue)) {
		present.unshift({ id: currentValue });
	}
	const parts = ['<option value="">(default)</option>'];
	for (const e of present) {
		const sel = e.id === currentValue ? ' selected' : '';
		// Label: alias if available, else id. Title attribute always shows raw
		// id so hovering disambiguates aliases that map to similar names.
		const label = e.alias || e.id;
		const title = e.alias ? e.alias + ' (' + e.id + ')' : e.id;
		parts.push('<option value="' + esc(e.id) + '" title="' + esc(title) + '"' + sel + '>' + esc(label) + '</option>');
	}
	return parts.join('');
}

const BINARY_THINKING_FORMATS = ['qwen-chat-template', 'qwen', 'zai'];

function findAvailableModel(provider: any, id: any) {
	const list = (diskState && diskState.availableModels) || [];
	return list.find((m: any) => m.provider === provider && m.id === id) || null;
}

// Thinking <option>s for a mode, mirroring the chat picker: non-reasoning →
// (default)+off; binary qwen/zai → (default)+off+on; leveled → (default)+off+
// mapped levels. `selected` is the mode's stored thinkingLevel ('' = default).
function modeThinkingOptionsHtml(provider: any, id: any, selected: any) {
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
		if (lvl === 'xhigh' && mapped === undefined) continue;
		html += opt(lvl, lvl, sel === lvl);
	}
	return html;
}

function renderModes() {
	const root = el('mode-cards');
	root.innerHTML = '';
	const providerIndex = buildProviderIndex();
	for (const name of MODE_NAMES) {
		const draft = modesDraft[name];
		const card = document.createElement('div');
		card.className = 'mode-card' + (modeDirty(name) ? ' dirty' : '');
		card.dataset.mode = name;
		card.innerHTML =
			'<div class="mode-name ' + name + '">' + name + '</div>' +
			'<select data-mode="' + name + '" data-field="provider">' + providerOptionsHtml(draft.provider, providerIndex) + '</select>' +
			'<select data-mode="' + name + '" data-field="id">' + modelOptionsHtml(draft.id, draft.provider, providerIndex) + '</select>' +
			'<select data-mode="' + name + '" data-field="thinking">' + modeThinkingOptionsHtml(draft.provider, draft.id, draft.thinking) + '</select>';
		root.appendChild(card);
		// thinking <select> uses `selected` attributes (model-aware), so no
		// post-hoc .value assignment.
	}
	qa(root, 'select').forEach((el: any) => {
		el.addEventListener('change', () => {
			const name = el.getAttribute('data-mode');
			const field = el.getAttribute('data-field');
			if (!name || !field || !modesDraft[name]) return;
			modesDraft[name][field] = el.value;
			// Changing provider invalidates the model selection; changing the
			// model changes which thinking options apply — re-render either way.
			if (field === 'provider') {
				modesDraft[name].id = '';
				renderModes();
			} else if (field === 'id') {
				renderModes();
			} else {
				const card = el.closest('.mode-card');
				if (card) card.classList.toggle('dirty', modeDirty(name));
			}
			updateSaveBar();
		});
	});
}

// Prompts tab: all four mode system prompts + the auto-title prompt + the
// compaction additional-focus. Mode prompts share modesDraft with the Modes
// tab, so dirty tracking (modeDirty) is unchanged.
function renderPrompts() {
	const root = el('prompt-modes');
	if (root) {
		root.innerHTML = '';
		for (const name of MODE_NAMES) {
			const draft = modesDraft[name] || { prompt: '' };
			const overridden = (draft.prompt || '') !== defaultPrompt(name) && (draft.prompt || '').trim() !== '';
			const block = document.createElement('div');
			block.className = 'prompt-block' + (modeDirty(name) ? ' dirty' : '');
			block.innerHTML =
				'<div class="mode-prompt-head">' +
					'<span class="mode-name ' + name + '">' + name + '</span>' +
					(overridden ? '<span class="mode-prompt-badge">' + esc(t('settings.modes.promptCustom')) + '</span>' : '') +
					'<span class="spacer"></span>' +
					'<button class="ghost" data-prompt-reset="' + esc(name) + '">' + esc(t('settings.modes.resetDefault')) + '</button>' +
				'</div>' +
				'<textarea class="mode-prompt-ta" rows="10" spellcheck="false" data-mode="' + esc(name) + '" data-field="prompt">' + esc(draft.prompt || '') + '</textarea>';
			root.appendChild(block);
		}
		qa(root, 'textarea[data-field="prompt"]').forEach((el: any) => {
			el.addEventListener('input', () => {
				const name = el.getAttribute('data-mode');
				if (!name || !modesDraft[name]) return;
				modesDraft[name].prompt = el.value;
				const block = el.closest('.prompt-block');
				if (block) block.classList.toggle('dirty', modeDirty(name));
				updateSaveBar();
			});
		});
		qa(root, 'button[data-prompt-reset]').forEach((btn: any) => {
			btn.addEventListener('click', () => {
				const name = btn.getAttribute('data-prompt-reset');
				if (!name || !modesDraft[name]) return;
				modesDraft[name].prompt = defaultPrompt(name);
				renderPrompts();
				updateSaveBar();
			});
		});
	}
	const toggleBadge = (id: any, on: any) => {
		const b = el(id);
		if (b) b.classList.toggle('hidden', !on);
	};
	const titleTa = el('autotitle-prompt-ta');
	if (titleTa) {
		titleTa.value = autoTitlePromptDraft;
		toggleBadge('autotitle-badge', autoTitleOverrideFromDraft().trim() !== '');
		titleTa.oninput = () => {
			autoTitlePromptDraft = titleTa.value;
			toggleBadge('autotitle-badge', autoTitleOverrideFromDraft().trim() !== '');
			updateSaveBar();
		};
		// "Reset to default" restores the built-in prompt text (= clears override).
		const reset = el('autotitle-prompt-reset');
		if (reset) reset.onclick = () => { autoTitlePromptDraft = defaultAutoTitle(); titleTa.value = autoTitlePromptDraft; toggleBadge('autotitle-badge', false); updateSaveBar(); };
	}
	const compactTa = el('compact-instructions-ta');
	if (compactTa) {
		compactTa.value = compactInstructionsDraft;
		toggleBadge('compact-badge', compactInstructionsDraft.trim() !== '');
		compactTa.oninput = () => {
			compactInstructionsDraft = compactTa.value;
			toggleBadge('compact-badge', compactInstructionsDraft.trim() !== '');
			updateSaveBar();
		};
		const reset = el('compact-instructions-reset');
		if (reset) reset.onclick = () => { compactInstructionsDraft = ''; compactTa.value = ''; toggleBadge('compact-badge', false); updateSaveBar(); };
	}
}

function renderAuth() {
	const body = el('auth-body');
	body.innerHTML = '';
	const onDisk = diskAuth();
	// Combined view: existing (minus pending removes) + pending adds
	const entries = [];
	for (const [id, info] of Object.entries(onDisk) as [string, any][]) {
		if (authRemovesDraft.has(id)) continue;
		entries.push({ id, type: info.type, pending: false });
	}
	for (const id of Object.keys(authAddsDraft)) {
		entries.push({ id, type: 'api_key', pending: true });
	}
	// Also show removed entries grayed (so user can undo)
	const removedEntries = [];
	for (const id of authRemovesDraft) {
		removedEntries.push({ id, type: (onDisk[id] && onDisk[id].type) || '?' });
	}

	if (entries.length === 0 && removedEntries.length === 0) {
		body.innerHTML = '<tr><td colspan="3"><em>' + esc(t('settings.auth.none')) + '</em></td></tr>';
		return;
	}
	for (const e of entries) {
		const tr = document.createElement('tr');
		tr.className = 'auth-row' + (e.pending ? ' dirty' : '');
		tr.innerHTML =
			'<td>' + esc(e.id) + (e.pending ? ' <small style="color: var(--vscode-descriptionForeground)">(draft)</small>' : '') + '</td>' +
			'<td>' + esc(e.type) + '</td>' +
			'<td><button class="danger" data-del-auth="' + esc(e.id) + '">✕</button></td>';
		body.appendChild(tr);
	}
	for (const e of removedEntries) {
		const tr = document.createElement('tr');
		tr.className = 'auth-row dirty';
		tr.innerHTML =
			'<td><s>' + esc(e.id) + '</s> <small style="color: var(--vscode-errorForeground)">' + esc(t('settings.tag.pendingDelete')) + '</small></td>' +
			'<td>' + esc(e.type) + '</td>' +
			'<td><button class="ghost" data-undo-auth="' + esc(e.id) + '">↶</button></td>';
		body.appendChild(tr);
	}
	qa(body, 'button[data-del-auth]').forEach((btn: any) => {
		btn.addEventListener('click', () => {
			const id = btn.getAttribute('data-del-auth');
			if (!id) return;
			if (authAddsDraft[id]) delete authAddsDraft[id];
			else authRemovesDraft.add(id);
			renderAuth();
			updateSaveBar();
		});
	});
	qa(body, 'button[data-undo-auth]').forEach((btn: any) => {
		btn.addEventListener('click', () => {
			const id = btn.getAttribute('data-undo-auth');
			if (!id) return;
			authRemovesDraft.delete(id);
			renderAuth();
			updateSaveBar();
		});
	});
}

// Each provider card stays expanded with form fields:
// provider id / display name / base URL / API key + model list + discovery.
// The "discovery" feature queries baseUrl/models (OpenAI-compatible) and shows
// a checkbox picker for bulk-add.
const discoveryState: Record<string, any> = {};  // providerName -> { ids: [], filter: '', selected: Set, loading: false, error: '' }

function provDirty(name: any) {
	const onDisk = diskModels();
	const a = (onDisk.providers && onDisk.providers[name]) || null;
	const b = (modelsDraft.providers && modelsDraft.providers[name]) || null;
	return JSON.stringify(a) !== JSON.stringify(b);
}

function renderProviders() {
	const root = el('providers-list');
	root.innerHTML = '';
	const providers = (modelsDraft && modelsDraft.providers) || {};
	const entries = Object.entries(providers) as [string, any][];
	if (entries.length === 0) {
		root.innerHTML = '<div class="note">' + esc(t('settings.providers.empty')) + '</div>';
		return;
	}
	for (const [name, cfg] of entries) {
		const card = document.createElement('div');
		card.className = 'provider-card' + (provDirty(name) ? ' dirty' : '');
		card.dataset.prov = name;
		card.innerHTML =
			'<div class="card-header">' +
				'<div class="card-title">✦ ' + esc(t('settings.providers.editTitle')) + '</div>' +
				'<button class="danger" data-del-prov>' + esc(t('settings.providers.remove')) + '</button>' +
			'</div>' +
			'<p class="card-sub">' + esc(t('settings.providers.sub')) + '</p>' +
			'<div class="field">' +
				'<label>' + esc(t('settings.providers.id')) + '</label>' +
				'<input type="text" data-field="__name" value="' + esc(name) + '" placeholder="my-vllm" />' +
				'<div class="field-hint">' + esc(t('settings.providers.idHint')) + '</div>' +
			'</div>' +
			'<div class="field">' +
				'<label>' + esc(t('settings.providers.displayName')) + '</label>' +
				'<input type="text" data-field="name" value="' + esc(cfg.name || '') + '" placeholder="' + esc(name) + '" />' +
			'</div>' +
			'<div class="field">' +
				'<label>' + esc(t('settings.providers.baseUrl')) + '</label>' +
				'<input type="text" data-field="baseUrl" value="' + esc(cfg.baseUrl || '') + '" placeholder="https://api.example.com/v1" />' +
			'</div>' +
			'<div class="field">' +
				'<label>' + esc(t('settings.providers.apiKey')) + '</label>' +
				'<input type="password" data-field="apiKey" value="' + esc(cfg.apiKey || '') + '" placeholder="sk-..." />' +
				'<div class="field-hint">' + esc(t('settings.providers.apiKeyHint')) + '</div>' +
			'</div>' +
			'<div class="field">' +
				'<label>' + esc(t('settings.providers.apiType')) + '</label>' +
				'<select data-field="api">' + API_TYPE_HTML + '<option value="">(auto)</option></select>' +
				'<div class="field-hint">' + esc(t('settings.providers.apiTypeHint')) + '</div>' +
			'</div>' +
			'<div class="subsection-header">' +
				'<h3>' + esc(t('settings.providers.models')) + '</h3>' +
				'<button class="ghost" data-discover>' + esc(t('settings.providers.discover')) + '</button>' +
			'</div>' +
			'<div data-models-area></div>' +
			'<button class="ghost" data-add-model style="margin-top: 8px;">' + esc(t('settings.providers.addManual')) + '</button>' +
			'<div data-disc-area></div>';
		root.appendChild(card);
		q(card, 'select[data-field="api"]').value = cfg.api || '';
		renderModelRows(q(card, '[data-models-area]'), name, cfg.models || []);
		renderDiscoveryFor(q(card, '[data-disc-area]'), name);
	}

	// Wire field inputs
	qa(root, 'input[data-field], select[data-field]').forEach((el: any) => {
		el.addEventListener('input', () => {
			const card = el.closest('.provider-card');
			const provName = card?.dataset.prov;
			const field = el.getAttribute('data-field');
			if (!provName || !field) return;
			const cfg = modelsDraft.providers[provName];
			if (!cfg) return;
			if (field === '__name') {
				// Apply rename on blur (deferred); keep editing in place for now
				return;
			}
			cfg[field] = el.value;
			card.classList.toggle('dirty', provDirty(provName));
			updateSaveBar();
		});
	});
	// Rename on blur to preserve focus while typing
	qa(root, 'input[data-field="__name"]').forEach((el: any) => {
		el.addEventListener('blur', () => {
			const card = el.closest('.provider-card');
			const oldName = card?.dataset.prov;
			const newName = el.value.trim();
			if (!oldName || !newName || oldName === newName) return;
			if (modelsDraft.providers[newName]) {
				showToast(t('settings.providers.idExists'), true);
				el.value = oldName;
				return;
			}
			modelsDraft.providers[newName] = modelsDraft.providers[oldName];
			delete modelsDraft.providers[oldName];
			if (discoveryState[oldName]) {
				discoveryState[newName] = discoveryState[oldName];
				delete discoveryState[oldName];
			}
			renderProviders();
			updateSaveBar();
		});
	});
	qa(root, 'button[data-del-prov]').forEach((btn: any) => {
		btn.addEventListener('click', () => {
			const card = btn.closest('.provider-card');
			const n = card?.dataset.prov;
			if (!n) return;
			delete modelsDraft.providers[n];
			delete discoveryState[n];
			// Whole provider gone → every mode pinned to it needs fallback.
			autoFallbackModes();
			renderProviders();
			renderModes();
			renderAutoTitle();
			updateSaveBar();
		});
	});
	qa(root, 'button[data-add-model]').forEach((btn: any) => {
		btn.addEventListener('click', () => {
			const card = btn.closest('.provider-card');
			const n = card?.dataset.prov;
			if (!n) return;
			const cfg = modelsDraft.providers[n];
			if (!cfg) return;
			if (!cfg.models) cfg.models = [];
			cfg.models.push({ id: '', name: '', contextWindow: '', maxTokens: '', reasoning: false });
			renderProviders();
			updateSaveBar();
		});
	});
	qa(root, 'button[data-discover]').forEach((btn: any) => {
		btn.addEventListener('click', () => {
			const card = btn.closest('.provider-card');
			const n = card?.dataset.prov;
			if (!n) return;
			const cfg = modelsDraft.providers[n];
			if (!cfg?.baseUrl) {
				showToast(t('settings.providers.baseUrlFirst'), true);
				return;
			}
			discoveryState[n] = { ids: [], filter: '', selected: new Set(), loading: true, error: '', requestId: 'r' + Date.now() };
			renderProviders();
			post({
				kind: 'discover-models',
				baseUrl: cfg.baseUrl,
				apiKey: cfg.apiKey || '',
				requestId: discoveryState[n].requestId,
				providerName: n,  // echo back so we can route the response
			});
		});
	});
}

// thinkingFormat values Pi understands (pi-ai types.d.ts). Empty = auto-detect
// from the provider/baseUrl. "qwen-chat-template" uses chat_template_kwargs.
const THINKING_FORMATS = ['openai', 'openrouter', 'deepseek', 'together', 'zai', 'qwen', 'qwen-chat-template', 'string-thinking'];

function thinkingFormatOptionsHtml(selected: any) {
	const list = THINKING_FORMATS.slice();
	// Preserve an on-disk value we don't recognize so save can't silently drop it.
	if (selected && list.indexOf(selected) === -1) list.push(selected);
	let html = '<option value=""' + (!selected ? ' selected' : '') + '>(auto)</option>';
	for (const f of list) {
		html += '<option value="' + esc(f) + '"' + (f === selected ? ' selected' : '') + '>' + esc(f) + '</option>';
	}
	return html;
}

function renderModelRows(container: any, provName: any, models: any) {
	container.innerHTML = '';
	if (models.length === 0) {
		container.innerHTML = '<div style="font-size: 11px; color: var(--vscode-descriptionForeground); padding: 6px 0;">' + esc(t('settings.models.empty')) + '</div>';
		return;
	}
	// Header
	const header = document.createElement('div');
	header.className = 'model-grid';
	header.innerHTML = '<div class="label">#</div><div class="label">ID</div><div class="label">' + esc(t('settings.models.colName')) + '</div><div class="label" style="text-align:center">' + esc(t('settings.models.colReasoning')) + '</div><div class="label">' + esc(t('settings.models.colThinkingFormat')) + '</div><div></div>';
	container.appendChild(header);
	models.forEach((m: any, idx: any) => {
		const row = document.createElement('div');
		row.className = 'model-row-card';
		const reasoningChecked = m.reasoning ? 'checked' : '';
		const tf = (m.compat && m.compat.thinkingFormat) || '';
		row.innerHTML =
			'<div class="row-num">' + (idx + 1) + '</div>' +
			'<input type="text" placeholder="model-id" value="' + esc(m.id || '') + '" data-mp="' + esc(provName) + '" data-mi="' + idx + '" data-mf="id" />' +
			'<input type="text" placeholder="(optional)" value="' + esc(m.name || '') + '" data-mp="' + esc(provName) + '" data-mi="' + idx + '" data-mf="name" />' +
			'<label class="reasoning-cell" title="' + esc(t('settings.models.reasoningTitle')) + '"><input type="checkbox" ' + reasoningChecked + ' data-mp="' + esc(provName) + '" data-mi="' + idx + '" data-mf="reasoning" /></label>' +
			// thinking-format dropdown only applies to reasoning models — hidden
			// (cell kept for grid alignment) until reasoning is checked.
			'<div class="tf-cell"><select title="' + esc(t('settings.models.thinkingFormatTitle')) + '" data-mp="' + esc(provName) + '" data-mi="' + idx + '" data-mf="thinkingFormat"' + (m.reasoning ? '' : ' style="display:none"') + '>' + thinkingFormatOptionsHtml(tf) + '</select></div>' +
			'<button class="danger" data-del-model="' + esc(provName) + '" data-mi="' + idx + '" title="' + esc(t('settings.providers.remove')) + '">✕</button>';
		container.appendChild(row);
	});
	qa(container, '[data-mf]').forEach((el: any) => {
		const isCheckbox = el.type === 'checkbox';
		const evt = isCheckbox || el.tagName === 'SELECT' ? 'change' : 'input';
		el.addEventListener(evt, () => {
			const p = el.getAttribute('data-mp');
			const i = parseInt(el.getAttribute('data-mi'), 10);
			const f = el.getAttribute('data-mf');
			if (!p || isNaN(i) || !f) return;
			const cfg = modelsDraft.providers[p];
			if (!cfg?.models?.[i]) return;
			const model = cfg.models[i];
			if (f === 'thinkingFormat') {
				// Nested under compat. Empty → remove (back to auto-detect) and
				// drop an emptied compat object so we don't write `compat: {}`.
				const v = el.value;
				if (v) {
					model.compat = Object.assign({}, model.compat, { thinkingFormat: v });
				} else if (model.compat) {
					delete model.compat.thinkingFormat;
					if (Object.keys(model.compat).length === 0) delete model.compat;
				}
			} else {
				model[f] = isCheckbox ? el.checked : el.value;
			}
			// Reasoning toggle controls whether the thinking-format dropdown is
			// shown (it's meaningless for non-reasoning models).
			if (f === 'reasoning') {
				const row = el.closest('.model-row-card');
				const sel = row && q(row, 'select[data-mf="thinkingFormat"]');
				if (sel) sel.style.display = el.checked ? '' : 'none';
			}
			// id change can rename a model — any mode pinned to the old id
			// loses its target and needs fallback.
			if (f === 'id') {
				autoFallbackModes();
				renderModes();
				renderAutoTitle();
			}
			updateSaveBar();
			const card = el.closest('.provider-card');
			if (card) card.classList.toggle('dirty', provDirty(p));
		});
	});
	qa(container, 'button[data-del-model]').forEach((btn: any) => {
		btn.addEventListener('click', () => {
			const p = btn.getAttribute('data-del-model');
			const i = parseInt(btn.getAttribute('data-mi'), 10);
			if (!p || isNaN(i)) return;
			const cfg = modelsDraft.providers[p];
			if (cfg?.models) {
				cfg.models.splice(i, 1);
				// Delete may have removed a model that modes/autoTitle reference.
				autoFallbackModes();
				renderProviders();
				renderModes();
				renderAutoTitle();
				updateSaveBar();
			}
		});
	});
}

function renderDiscoveryFor(container: any, provName: any) {
	const st = discoveryState[provName];
	container.innerHTML = '';
	if (!st) return;
	if (st.loading) {
		container.innerHTML = '<div class="disc-picker"><div class="disc-empty">' + esc(t('settings.disc.loading')) + '</div></div>';
		return;
	}
	if (st.error) {
		container.innerHTML =
			'<div class="disc-picker"><div class="disc-empty" style="color: var(--vscode-errorForeground)">' + esc(t('settings.disc.failed')) + esc(st.error) + '</div>' +
			'<div class="disc-footer"><button class="ghost" data-disc-close>' + esc(t('settings.close')) + '</button></div></div>';
		q(container, 'button[data-disc-close]').addEventListener('click', () => {
			delete discoveryState[provName];
			renderProviders();
		});
		return;
	}
	const filtered = st.ids.filter((id: any) => !st.filter || id.toLowerCase().includes(st.filter.toLowerCase()));
	const cfg = modelsDraft.providers[provName];
	const existing = new Set(((cfg && cfg.models) || []).map((m: any) => m.id));

	const picker = document.createElement('div');
	picker.className = 'disc-picker';
	picker.innerHTML =
		'<div class="disc-header">' +
			'<div class="disc-title">' + esc(t('settings.disc.found', { n: st.ids.length })) + '</div>' +
			'<div class="disc-actions">' +
				'<button data-disc-all>' + esc(t('settings.disc.selectAll')) + '</button>' +
				'<button data-disc-none>' + esc(t('settings.disc.deselectAll')) + '</button>' +
			'</div>' +
		'</div>' +
		'<input type="text" class="disc-search" placeholder="' + esc(t('settings.disc.search')) + '" value="' + esc(st.filter) + '" />' +
		'<div class="disc-list"></div>' +
		'<div class="disc-footer">' +
			'<button data-disc-add>' + esc(t('settings.disc.add', { n: st.selected.size })) + '</button>' +
			'<button class="ghost" data-disc-close>' + esc(t('settings.cancel')) + '</button>' +
		'</div>';
	container.appendChild(picker);
	const list = q(picker, '.disc-list');
	if (filtered.length === 0) {
		list.innerHTML = '<div class="disc-empty">' + esc(t('settings.disc.noResults')) + '</div>';
	} else {
		for (const id of filtered) {
			const item = document.createElement('label');
			item.className = 'disc-item';
			const isExisting = existing.has(id);
			item.innerHTML =
				'<input type="checkbox" ' + (st.selected.has(id) ? 'checked' : '') + (isExisting ? ' disabled' : '') + ' data-disc-id="' + esc(id) + '" />' +
				'<span>' + esc(id) + (isExisting ? ' <small style="color: var(--vscode-descriptionForeground)">' + esc(t('settings.disc.alreadyAdded')) + '</small>' : '') + '</span>';
			list.appendChild(item);
		}
		qa(list, 'input[data-disc-id]').forEach((cb) => {
			cb.addEventListener('change', () => {
				const id = cb.getAttribute('data-disc-id');
				if (cb.checked) st.selected.add(id);
				else st.selected.delete(id);
				q(picker, 'button[data-disc-add]').textContent = t('settings.disc.add', { n: st.selected.size });
			});
		});
	}
	q(picker, '.disc-search').addEventListener('input', (ev: any) => {
		st.filter = ev.target.value;
		renderProviders();
		// Re-focus the search input after re-render
		setTimeout(() => {
			const newCard = q(document, '.provider-card[data-prov="' + CSS.escape(provName) + '"] .disc-search');
			if (newCard) {
				newCard.focus();
				newCard.setSelectionRange(st.filter.length, st.filter.length);
			}
		}, 0);
	});
	q(picker, 'button[data-disc-all]').addEventListener('click', () => {
		for (const id of filtered) if (!existing.has(id)) st.selected.add(id);
		renderProviders();
	});
	q(picker, 'button[data-disc-none]').addEventListener('click', () => {
		st.selected.clear();
		renderProviders();
	});
	q(picker, 'button[data-disc-close]').addEventListener('click', () => {
		delete discoveryState[provName];
		renderProviders();
	});
	q(picker, 'button[data-disc-add]').addEventListener('click', () => {
		if (!cfg) return;
		if (!cfg.models) cfg.models = [];
		const existingIds = new Set(cfg.models.map((m: any) => m.id));
		for (const id of st.selected) {
			if (!existingIds.has(id)) cfg.models.push({ id, name: '', contextWindow: '', maxTokens: '', reasoning: false });
		}
		showToast(t('settings.disc.added', { n: st.selected.size }));
		delete discoveryState[provName];
		renderProviders();
		updateSaveBar();
	});
}

/** If a mode (or autoTitle) is configured to a model that's no longer
 *  visible (allowlist removed it, custom provider deleted it, model id
 *  edited), auto-replace with another visible model. Prefers same provider,
 *  falls back to any provider, finally clears to default if nothing exists.
 *  Returns true if any draft was modified so callers can re-render. */
function autoFallbackModes() {
	const providerIndex = buildProviderIndex(true);
	const firstVisible = () => {
		for (const [prov, entries] of providerIndex.entries()) {
			if (entries.length > 0) return { provider: prov, id: entries[0].id };
		}
		return null;
	};
	const replacements: string[] = [];
	const fixOne = (label: any, draft: any) => {
		if (!draft.provider || !draft.id) return;
		const entries = providerIndex.get(draft.provider) || [];
		if (entries.some((e: any) => e.id === draft.id)) return;
		const old = draft.provider + '/' + draft.id;
		if (entries.length > 0) {
			draft.id = entries[0].id;
			replacements.push(label + ': ' + old + ' → ' + draft.provider + '/' + draft.id);
		} else {
			const fb = firstVisible();
			if (fb) {
				draft.provider = fb.provider;
				draft.id = fb.id;
				replacements.push(label + ': ' + old + ' → ' + fb.provider + '/' + fb.id);
			} else {
				draft.provider = '';
				draft.id = '';
				replacements.push(label + ': ' + old + ' → (default)');
			}
		}
	};
	for (const m of MODE_NAMES) fixOne(t('settings.fallback.modeLabel', { mode: m }), modesDraft[m] || { provider: '', id: '' });
	fixOne(t('settings.fallback.autoTitleLabel'), autoTitleDraft);
	fixOne(t('settings.fallback.compactModelLabel'), compactModelDraft);
	if (replacements.length) {
		showToast(t('settings.fallback.toast', { n: replacements.length, first: replacements[0] })
			+ (replacements.length > 1 ? t('settings.fallback.more', { n: replacements.length - 1 }) : ''));
	}
	return replacements.length > 0;
}

function renderAutoTitle() {
	const card = el('autotitle-card');
	if (!card) return;
	card.classList.toggle('dirty', autoTitleDirty());
	const providerIndex = buildProviderIndex();
	const provSel = el('autotitle-provider');
	const idSel = el('autotitle-id');
	provSel.innerHTML = providerOptionsHtml(autoTitleDraft.provider, providerIndex);
	idSel.innerHTML = modelOptionsHtml(autoTitleDraft.id, autoTitleDraft.provider, providerIndex);
	provSel.onchange = () => {
		autoTitleDraft.provider = provSel.value;
		autoTitleDraft.id = '';
		renderAutoTitle();
		updateSaveBar();
	};
	idSel.onchange = () => {
		autoTitleDraft.id = idSel.value;
		card.classList.toggle('dirty', autoTitleDirty());
		updateSaveBar();
	};
}

function renderCompactModel() {
	const card = el('compactmodel-card');
	if (!card) return;
	card.classList.toggle('dirty', compactModelDirty());
	const providerIndex = buildProviderIndex();
	const provSel = el('compactmodel-provider');
	const idSel = el('compactmodel-id');
	provSel.innerHTML = providerOptionsHtml(compactModelDraft.provider, providerIndex);
	idSel.innerHTML = modelOptionsHtml(compactModelDraft.id, compactModelDraft.provider, providerIndex);
	provSel.onchange = () => {
		compactModelDraft.provider = provSel.value;
		compactModelDraft.id = '';
		renderCompactModel();
		updateSaveBar();
	};
	idSel.onchange = () => {
		compactModelDraft.id = idSel.value;
		card.classList.toggle('dirty', compactModelDirty());
		updateSaveBar();
	};
}

function renderAllowlist() {
	const root = el('allowlist-cards');
	if (!root) return;
	root.innerHTML = '';
	// Allowlist UI must show ALL models so the user can toggle them — pass
	// applyAllowlist=false so we don't filter out the very items being managed.
	const providerIndex = buildProviderIndex(false);
	const providers = [...providerIndex.keys()].sort();
	if (providers.length === 0) {
		root.innerHTML = '<div class="note">' + esc(t('settings.allowlist.empty')) + '</div>';
		return;
	}
	for (const prov of providers) {
		const entries = providerIndex.get(prov) || [];
		const allowed = Array.isArray(allowlistDraft[prov]) ? new Set(allowlistDraft[prov]) : null;
		// allowed === null → all visible (no filter for this provider)
		// allowed === Set → only those ids visible
		const card = document.createElement('div');
		card.className = 'provider-card';
		const filtered = allowed && allowed.size < entries.length;
		card.innerHTML =
			'<div class="provider-header">' +
				'<div class="provider-name">' + esc(prov) + '</div>' +
				'<div class="provider-meta">' +
					(filtered ? esc(t('settings.allowlist.shownPartial', { shown: allowed.size, total: entries.length })) : esc(t('settings.allowlist.shownAll', { total: entries.length }))) +
				'</div>' +
				'<div class="provider-actions">' +
					'<button class="ghost" data-allow-all="' + esc(prov) + '">' + esc(t('settings.allowlist.all')) + '</button>' +
					'<button class="ghost" data-allow-none="' + esc(prov) + '">' + esc(t('settings.allowlist.none')) + '</button>' +
				'</div>' +
			'</div>' +
			'<div class="allowlist-grid" data-allow-grid="' + esc(prov) + '"></div>';
		root.appendChild(card);
		const grid = q(card, '[data-allow-grid]');
		for (const e of entries) {
			const checked = allowed ? allowed.has(e.id) : true;
			const label = document.createElement('label');
			label.className = 'allowlist-item';
			const title = e.alias ? e.alias + ' (' + e.id + ')' : e.id;
			label.title = title;
			label.innerHTML =
				'<input type="checkbox" data-allow-prov="' + esc(prov) + '" data-allow-id="' + esc(e.id) + '" ' + (checked ? 'checked' : '') + ' />' +
				'<span>' + esc(e.alias || e.id) + '</span>';
			grid.appendChild(label);
		}
	}
	// Wire change/click handlers.
	qa(root, 'input[type="checkbox"][data-allow-prov]').forEach((el: any) => {
		el.addEventListener('change', () => {
			const prov = el.getAttribute('data-allow-prov');
			const id = el.getAttribute('data-allow-id');
			if (!prov || !id) return;
			const entries = providerIndex.get(prov) || [];
			// Start from the current effective set (all visible if no filter).
			const current = Array.isArray(allowlistDraft[prov])
				? new Set(allowlistDraft[prov])
				: new Set(entries.map((e: any) => e.id));
			if (el.checked) current.add(id);
			else current.delete(id);
			// If user re-checked everything, drop the key entirely (= no filter).
			if (current.size === entries.length) delete allowlistDraft[prov];
			else allowlistDraft[prov] = [...current] as string[];
			// Auto-fallback any mode (or autoTitle) whose model just dropped
			// out of the visible set. Toast surfaces the replacement so the
			// user notices before they save.
			autoFallbackModes();
			renderAllowlist();
			renderModes();
			renderAutoTitle();
			updateSaveBar();
		});
	});
	qa(root, 'button[data-allow-all]').forEach((btn: any) => {
		btn.addEventListener('click', () => {
			const prov = btn.getAttribute('data-allow-all');
			if (prov) delete allowlistDraft[prov];
			// Auto-fallback any mode (or autoTitle) whose model just dropped
			// out of the visible set. Toast surfaces the replacement so the
			// user notices before they save.
			autoFallbackModes();
			renderAllowlist();
			renderModes();
			renderAutoTitle();
			updateSaveBar();
		});
	});
	qa(root, 'button[data-allow-none]').forEach((btn: any) => {
		btn.addEventListener('click', () => {
			const prov = btn.getAttribute('data-allow-none');
			if (prov) allowlistDraft[prov] = [];
			// Auto-fallback any mode (or autoTitle) whose model just dropped
			// out of the visible set. Toast surfaces the replacement so the
			// user notices before they save.
			autoFallbackModes();
			renderAllowlist();
			renderModes();
			renderAutoTitle();
			updateSaveBar();
		});
	});
}

function renderCompact() {
	const toggle = el('dynamic-compaction');
	if (toggle) {
		toggle.checked = dynamicCompactionDraft;
		toggle.onchange = () => { dynamicCompactionDraft = toggle.checked; updateSaveBar(); };
	}
	const input = el('compact-threshold');
	if (!input) return;
	input.value = compactDraft;
	const valueLabel = el('compact-value');
	const showValue = () => { if (valueLabel) valueLabel.textContent = input.value + '%'; };
	showValue();
	const hint = el('compact-default-hint');
	if (hint) hint.textContent = t('settings.compact.defaultHint', { n: defaultCompact() });
	input.oninput = () => { compactDraft = input.value; showValue(); updateSaveBar(); };
	const reset = el('compact-reset');
	if (reset) reset.onclick = () => { compactDraft = String(defaultCompact()); input.value = compactDraft; showValue(); updateSaveBar(); };
}

function render(s: any) {
	diskState = s;
	modesDraft = {};
	for (const n of MODE_NAMES) {
		const d = diskMode(n);
		modesDraft[n] = { provider: d.provider, id: d.id, thinking: d.thinking, prompt: d.promptOverride || defaultPrompt(n) };
	}
	autoTitleDraft = diskAutoTitle();
	compactModelDraft = diskCompactModel();
	authAddsDraft = {};
	authRemovesDraft = new Set();
	modelsDraft = JSON.parse(JSON.stringify(diskModels()));
	allowlistDraft = JSON.parse(JSON.stringify(diskAllowlist()));
	compactDraft = String(diskCompactOverride() != null ? diskCompactOverride() : defaultCompact());
	dynamicCompactionDraft = diskDynamicCompaction();
	autoTitlePromptDraft = diskAutoTitlePrompt() || defaultAutoTitle();
	compactInstructionsDraft = diskCompactInstructions();

	renderModes();
	renderPrompts();
	renderAutoTitle();
	renderCompactModel();
	renderAllowlist();
	renderAuth();
	renderProviders();
	renderCompact();
	updateOAuthButtons();
	updateSaveBar();
}

// Disable an OAuth login button when its provider already has an oauth-type
// credential on disk (api-key creds don't count — the user may still want to
// add an OAuth login). Leaves a button alone while its login flow is mid-air
// (cancel button visible).
const OAUTH_BTN_PROVIDERS = [
	{ statusKind: 'codex-status', providerId: 'openai-codex' },
	{ statusKind: 'anthropic-status', providerId: 'anthropic' },
];
function updateOAuthButtons() {
	let codexAuthed = false;
	for (const { statusKind, providerId } of OAUTH_BTN_PROVIDERS) {
		const ui = oauthUis[statusKind];
		if (!ui) continue;
		const cred = diskAuth()[providerId];
		const authed = !!(cred && cred.type === 'oauth');
		if (providerId === 'openai-codex') codexAuthed = authed;
		const inFlight = !ui.cancel.classList.contains('hidden');
		if (authed) {
			ui.btn.disabled = true;
			ui.status.textContent = t('settings.oauth.authed');
			ui.status.style.color = 'var(--vscode-charts-green, var(--vscode-foreground))';
		} else if (!inFlight) {
			ui.btn.disabled = false;
		}
	}
	// Codex usage button + one-shot auto-fetch, gated on Codex being authed.
	const usageBtn = el('codex-usage-btn');
	const usageOut = el('codex-usage');
	if (usageBtn) usageBtn.classList.toggle('hidden', !codexAuthed);
	if (!codexAuthed) {
		codexUsageFetched = false;
		if (usageOut) { usageOut.classList.add('hidden'); usageOut.textContent = ''; }
	} else if (!codexUsageFetched) {
		codexUsageFetched = true;
		requestCodexUsage();
	}
}

// Codex OAuth inline
// OAuth login buttons (Codex, Claude) share identical wiring; keyed by their
// status message kind so the status handler can find the right elements.
const oauthUis: Record<string, any> = {};
function wireOAuth(statusKind: any, btnId: any, cancelId: any, statusId: any, loginKind: any, cancelKind: any) {
	const btn = el(btnId);
	const cancel = el(cancelId);
	const status = el(statusId);
	if (!btn || !cancel || !status) return;
	btn.addEventListener('click', () => {
		btn.disabled = true;
		cancel.classList.remove('hidden');
		status.textContent = t('settings.oauth.starting');
		post({ kind: loginKind });
	});
	cancel.addEventListener('click', () => post({ kind: cancelKind }));
	oauthUis[statusKind] = { btn, cancel, status };
}
wireOAuth('codex-status', 'codex-login-btn', 'codex-cancel-btn', 'codex-status', 'codex-login', 'codex-login-cancel');
wireOAuth('anthropic-status', 'anthropic-login-btn', 'anthropic-cancel-btn', 'anthropic-status', 'anthropic-login', 'anthropic-login-cancel');

// Codex usage (ChatGPT subscription limits). Read-only; the host hits the
// usage endpoint with the stored OAuth token. Auto-fetched once per panel
// load when Codex is authed; the button re-fetches.
let codexUsageFetched = false;
function requestCodexUsage() {
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
function renderCodexUsage(msg: any) {
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

// Add auth (API key)
el('add-auth-btn').addEventListener('click', () => {
	const id = el('new-auth-id').value.trim();
	const key = el('new-auth-key').value;
	if (!id || !key) { showToast(t('settings.auth.needBoth'), true); return; }
	authAddsDraft[id] = key;
	el('new-auth-id').value = '';
	el('new-auth-key').value = '';
	renderAuth();
	updateSaveBar();
});

// Add custom provider — generate a unique placeholder name so the user can
// edit it inline (webview can't use window.prompt — it's blocked).
el('add-provider-btn').addEventListener('click', () => {
	let base = 'new-provider';
	let name = base;
	let n = 1;
	while (modelsDraft.providers[name]) {
		n++;
		name = base + '-' + n;
	}
	modelsDraft.providers[name] = { baseUrl: '', api: 'openai-completions', apiKey: '', models: [] };
	renderProviders();
	updateSaveBar();
	// Focus the new card's name input
	setTimeout(() => {
		const newCard = q(document, '.provider-card[data-prov="' + CSS.escape(name) + '"]');
		if (newCard) {
			newCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
			const nameInput = q(newCard, 'input[data-field="__name"]');
			if (nameInput) {
				nameInput.focus();
				nameInput.select();
			}
		}
	}, 50);
});

// Cancel
el('cancel-btn').addEventListener('click', () => {
	if (!diskState) return;
	render(diskState);
	showToast(t('settings.toast.reverted'));
});

// Save
el('save-btn').addEventListener('click', () => {
	const payload = {
		kind: 'save',
		modes: true,
		modeConfigs: modesDraft,
		autoTitle: autoTitleDraft,
		compactModel: compactModelDraft,
		modelAllowlist: allowlistDraft,
		authAdds: authAddsDraft,
		authRemoves: Array.from(authRemovesDraft),
		models: modelsDraft,
		autoCompactThreshold: (() => { const n = parseInt(compactDraft, 10); return Number.isFinite(n) ? n : null; })(),
		dynamicCompaction: dynamicCompactionDraft,
		autoTitlePrompt: autoTitleOverrideFromDraft(),
		compactInstructions: compactInstructionsDraft,
	};
	post(payload);
	showToast(t('settings.toast.saving'));
});

window.addEventListener('message', (ev) => {
	const msg = ev.data;
	if (!msg) return;
	if (msg.kind === 'state') render(msg.state);
	else if (msg.kind === 'error') showToast(msg.message || 'Error', true);
	else if (msg.kind === 'saved') showToast(t('settings.toast.saved', { files: (msg.files || []).join(', ') }));
	else if (msg.kind === 'codex-usage-result') renderCodexUsage(msg);
	else if (msg.kind === 'codex-status' || msg.kind === 'anthropic-status') {
		const ui = oauthUis[msg.kind];
		if (!ui) return;
		const s = msg.state;
		if (s === 'success') {
			ui.btn.disabled = false;
			ui.cancel.classList.add('hidden');
			ui.status.textContent = '✓ ' + (msg.message || t('settings.done'));
			ui.status.style.color = 'var(--vscode-charts-green, var(--vscode-foreground))';
			setTimeout(() => { ui.status.textContent = ''; ui.status.style.color = ''; }, 4000);
		} else if (s === 'error') {
			ui.btn.disabled = false;
			ui.cancel.classList.add('hidden');
			ui.status.textContent = '✗ ' + (msg.message || 'Error');
			ui.status.style.color = 'var(--vscode-errorForeground)';
		} else {
			ui.status.style.color = '';
			ui.status.textContent = msg.message || '';
		}
	}
	else if (msg.kind === 'discovered-models') {
		// Match by requestId so a stale response doesn't overwrite a newer one
		for (const [provName, st] of Object.entries(discoveryState)) {
			if (st.requestId !== msg.requestId) continue;
			st.loading = false;
			if (msg.error) { st.error = msg.error; }
			else { st.ids = msg.ids || []; st.selected = new Set(); }
			renderProviders();
			break;
		}
	}
});

function wireTabs() {
	const tabs = Array.from(qa(document, '.tab-btn'));
	const panels = Array.from(qa(document, '.tab-panel'));
	function activate(name: any) {
		tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
		panels.forEach((pn) => pn.classList.toggle('hidden', pn.dataset.tab !== name));
	}
	tabs.forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab)));
	if (tabs.length) activate(tabs[0].dataset.tab);
}
wireTabs();
const langSel = el('lang-select');
if (langSel) langSel.addEventListener('change', () => post({ kind: 'set-language', value: langSel.value }));
post({ kind: 'refresh' });
