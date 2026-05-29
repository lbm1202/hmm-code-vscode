// Settings-panel webview script. Extracted verbatim from the SETTINGS_JS_*
// template strings that used to live inline in src/settings-panel.ts, and
// loaded as a bundled asset via <script src>. Plain JS (not type-checked) —
// unchanged from when it was an injected string.
const vscode = acquireVsCodeApi();
const post = (msg) => vscode.postMessage(msg);
const MODE_NAMES = ["plan", "code", "debug", "ask"];
const THINKING_LEVELS = ["", "off", "minimal", "low", "medium", "high", "xhigh"];
const API_TYPES = ["openai-completions", "openai-responses", "anthropic-messages"];
const THINKING_HTML = THINKING_LEVELS.map((l) => '<option value="' + l + '">' + (l || '(default)') + '</option>').join('');
const API_TYPE_HTML = API_TYPES.map((t) => '<option value="' + t + '">' + t + '</option>').join('');
let diskState = null;
let modesDraft = {};
let autoTitleDraft = { provider: '', id: '' };
let authAddsDraft = {};           // provider id -> key (new ones to add)
let authRemovesDraft = new Set(); // provider ids to remove
let modelsDraft = { providers: {} };
// Per-provider model id allowlist draft. Empty obj or empty list per provider
// = no filter for that provider. Sent to host as modelAllowlist on save.
let allowlistDraft = {};

function showToast(text, isError) {
	const t = document.getElementById('toast');
	t.textContent = text;
	t.classList.toggle('error', !!isError);
	t.classList.remove('hidden');
	setTimeout(() => t.classList.add('hidden'), 2500);
}
function esc(s) {
	return String(s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function diskMode(name) {
	const cfg = (diskState && diskState.modes && diskState.modes.modes && diskState.modes.modes[name]) || {};
	const m = cfg.model;
	const isObj = m && typeof m === 'object';
	return {
		provider: isObj ? (m.provider || '') : '',
		id: isObj ? (m.id || '') : '',
		thinking: cfg.thinkingLevel || '',
	};
}
function diskAuth() { return (diskState && diskState.auth) || {}; }
function diskModels() {
	const m = diskState && diskState.models;
	return (m && typeof m === 'object' && m.providers) ? m : { providers: {} };
}

function modeDirty(name) {
	const d = diskMode(name);
	const draft = modesDraft[name] || { provider: '', id: '', thinking: '' };
	return d.provider !== draft.provider || d.id !== draft.id || d.thinking !== draft.thinking;
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

function diskAllowlist() {
	const a = diskState && diskState.modelAllowlist;
	return (a && typeof a === 'object') ? a : {};
}
function allowlistDirty() {
	// Preserve empty arrays — they mean "explicitly hide all from this provider",
	// distinct from a missing key which means "no filter".
	const norm = (obj) => {
		const out = {};
		for (const [k, v] of Object.entries(obj || {})) {
			if (Array.isArray(v)) out[k] = v.slice().sort();
		}
		return out;
	};
	return JSON.stringify(norm(allowlistDraft)) !== JSON.stringify(norm(diskAllowlist()));
}

function isDirty() {
	if (!diskState) return false;
	for (const n of MODE_NAMES) if (modeDirty(n)) return true;
	if (autoTitleDirty()) return true;
	if (authDirty()) return true;
	if (modelsDirty()) return true;
	if (allowlistDirty()) return true;
	return false;
}

function updateSaveBar() {
	const dirty = isDirty();
	document.getElementById('save-bar').classList.toggle('hidden', !dirty);
	if (!dirty) return;
	let modeD = 0, authD = 0;
	for (const n of MODE_NAMES) if (modeDirty(n)) modeD++;
	authD = Object.keys(authAddsDraft).length + authRemovesDraft.size;
	const parts = [];
	if (modeD) parts.push(modeD + '개 모드');
	if (autoTitleDirty()) parts.push('자동 제목 모델');
	if (authD) parts.push(authD + '개 인증');
	if (modelsDirty()) parts.push('커스텀 공급자');
	if (allowlistDirty()) parts.push('모델 필터');
	document.getElementById('dirty-detail').textContent = parts.length ? ' (' + parts.join(' · ') + ')' : '';
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
			if (allowed) map.set(prov, entries.filter((e) => allowed.has(e.id)));
		}
	}
	for (const arr of map.values())
		arr.sort((a, b) => (a.alias ?? a.id).localeCompare(b.alias ?? b.id));
	return map;
}

function providerOptionsHtml(currentValue, providerIndex) {
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

function modelOptionsHtml(currentValue, provider, providerIndex) {
	const entries = (provider && providerIndex.get(provider)) || [];
	const present = entries.slice();
	if (currentValue && !present.some((e) => e.id === currentValue)) {
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

function renderModes() {
	const root = document.getElementById('mode-cards');
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
			'<select data-mode="' + name + '" data-field="thinking">' + THINKING_HTML + '</select>';
		root.appendChild(card);
		card.querySelector('select[data-field="thinking"]').value = draft.thinking;
	}
	root.querySelectorAll('select').forEach((el) => {
		el.addEventListener('change', () => {
			const name = el.getAttribute('data-mode');
			const field = el.getAttribute('data-field');
			if (!name || !field || !modesDraft[name]) return;
			modesDraft[name][field] = el.value;
			// Changing provider invalidates the model selection — re-render
			// the card so the model dropdown shows the new provider's ids.
			if (field === 'provider') {
				modesDraft[name].id = '';
				renderModes();
			} else {
				const card = el.closest('.mode-card');
				if (card) card.classList.toggle('dirty', modeDirty(name));
			}
			updateSaveBar();
		});
	});
}

function renderAuth() {
	const body = document.getElementById('auth-body');
	body.innerHTML = '';
	const onDisk = diskAuth();
	// Combined view: existing (minus pending removes) + pending adds
	const entries = [];
	for (const [id, info] of Object.entries(onDisk)) {
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
		body.innerHTML = '<tr><td colspan="3"><em>인증된 공급자 없음</em></td></tr>';
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
			'<td><s>' + esc(e.id) + '</s> <small style="color: var(--vscode-errorForeground)">(삭제 예정)</small></td>' +
			'<td>' + esc(e.type) + '</td>' +
			'<td><button class="ghost" data-undo-auth="' + esc(e.id) + '">↶</button></td>';
		body.appendChild(tr);
	}
	body.querySelectorAll('button[data-del-auth]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const id = btn.getAttribute('data-del-auth');
			if (!id) return;
			if (authAddsDraft[id]) delete authAddsDraft[id];
			else authRemovesDraft.add(id);
			renderAuth();
			updateSaveBar();
		});
	});
	body.querySelectorAll('button[data-undo-auth]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const id = btn.getAttribute('data-undo-auth');
			if (!id) return;
			authRemovesDraft.delete(id);
			renderAuth();
			updateSaveBar();
		});
	});
}

// Each provider card stays expanded with form fields matching the reference UX:
// 공급자 ID / 표시 이름 / 기본 URL / API 키 + 모델 목록 + 모델 발견.
// The "discovery" feature queries baseUrl/models (OpenAI-compatible) and shows
// a checkbox picker for bulk-add.
const discoveryState = {};  // providerName -> { ids: [], filter: '', selected: Set, loading: false, error: '' }

function provDirty(name) {
	const onDisk = diskModels();
	const a = (onDisk.providers && onDisk.providers[name]) || null;
	const b = (modelsDraft.providers && modelsDraft.providers[name]) || null;
	return JSON.stringify(a) !== JSON.stringify(b);
}

function renderProviders() {
	const root = document.getElementById('providers-list');
	root.innerHTML = '';
	const providers = (modelsDraft && modelsDraft.providers) || {};
	const entries = Object.entries(providers);
	if (entries.length === 0) {
		root.innerHTML = '<div class="note">등록된 커스텀 공급자 없음. 아래 "+ 공급자 추가" 로 시작하세요.</div>';
		return;
	}
	for (const [name, cfg] of entries) {
		const card = document.createElement('div');
		card.className = 'provider-card' + (provDirty(name) ? ' dirty' : '');
		card.dataset.prov = name;
		card.innerHTML =
			'<div class="card-header">' +
				'<div class="card-title">✦ 공급자 편집</div>' +
				'<button class="danger" data-del-prov>제거</button>' +
			'</div>' +
			'<p class="card-sub">OpenAI 호환 공급자를 구성합니다. Pi 의 models.json 스키마를 따릅니다.</p>' +
			'<div class="field">' +
				'<label>공급자 ID</label>' +
				'<input type="text" data-field="__name" value="' + esc(name) + '" placeholder="my-vllm" />' +
				'<div class="field-hint">소문자, 숫자, 하이픈 또는 밑줄</div>' +
			'</div>' +
			'<div class="field">' +
				'<label>표시 이름</label>' +
				'<input type="text" data-field="name" value="' + esc(cfg.name || '') + '" placeholder="' + esc(name) + '" />' +
			'</div>' +
			'<div class="field">' +
				'<label>기본 URL</label>' +
				'<input type="text" data-field="baseUrl" value="' + esc(cfg.baseUrl || '') + '" placeholder="https://api.example.com/v1" />' +
			'</div>' +
			'<div class="field">' +
				'<label>API 키</label>' +
				'<input type="password" data-field="apiKey" value="' + esc(cfg.apiKey || '') + '" placeholder="sk-..." />' +
				'<div class="field-hint">선택사항. 환경변수나 헤더로 인증을 관리하는 경우 비워두세요.</div>' +
			'</div>' +
			'<div class="field">' +
				'<label>API 타입</label>' +
				'<select data-field="api">' + API_TYPE_HTML + '<option value="">(auto)</option></select>' +
				'<div class="field-hint">대부분의 OpenAI-호환 endpoint 는 openai-completions.</div>' +
			'</div>' +
			'<div class="subsection-header">' +
				'<h3>모델</h3>' +
				'<button class="ghost" data-discover>모델 발견</button>' +
			'</div>' +
			'<div data-models-area></div>' +
			'<button class="ghost" data-add-model style="margin-top: 8px;">+ 수동 추가</button>' +
			'<div data-disc-area></div>';
		root.appendChild(card);
		card.querySelector('select[data-field="api"]').value = cfg.api || '';
		renderModelRows(card.querySelector('[data-models-area]'), name, cfg.models || []);
		renderDiscoveryFor(card.querySelector('[data-disc-area]'), name);
	}

	// Wire field inputs
	root.querySelectorAll('input[data-field], select[data-field]').forEach((el) => {
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
	root.querySelectorAll('input[data-field="__name"]').forEach((el) => {
		el.addEventListener('blur', () => {
			const card = el.closest('.provider-card');
			const oldName = card?.dataset.prov;
			const newName = el.value.trim();
			if (!oldName || !newName || oldName === newName) return;
			if (modelsDraft.providers[newName]) {
				showToast('이미 존재하는 공급자 ID 입니다.', true);
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
	root.querySelectorAll('button[data-del-prov]').forEach((btn) => {
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
	root.querySelectorAll('button[data-add-model]').forEach((btn) => {
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
	root.querySelectorAll('button[data-discover]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const card = btn.closest('.provider-card');
			const n = card?.dataset.prov;
			if (!n) return;
			const cfg = modelsDraft.providers[n];
			if (!cfg?.baseUrl) {
				showToast('baseUrl 을 먼저 입력하세요.', true);
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

function thinkingFormatOptionsHtml(selected) {
	const list = THINKING_FORMATS.slice();
	// Preserve an on-disk value we don't recognize so save can't silently drop it.
	if (selected && list.indexOf(selected) === -1) list.push(selected);
	let html = '<option value=""' + (!selected ? ' selected' : '') + '>(auto)</option>';
	for (const f of list) {
		html += '<option value="' + esc(f) + '"' + (f === selected ? ' selected' : '') + '>' + esc(f) + '</option>';
	}
	return html;
}

function renderModelRows(container, provName, models) {
	container.innerHTML = '';
	if (models.length === 0) {
		container.innerHTML = '<div style="font-size: 11px; color: var(--vscode-descriptionForeground); padding: 6px 0;">등록된 모델 없음 — "모델 발견" 또는 "수동 추가" 로 등록</div>';
		return;
	}
	// Header
	const header = document.createElement('div');
	header.className = 'model-grid';
	header.innerHTML = '<div class="label">#</div><div class="label">ID</div><div class="label">이름</div><div class="label" style="text-align:center">추론</div><div class="label">thinking 형식</div><div></div>';
	container.appendChild(header);
	models.forEach((m, idx) => {
		const row = document.createElement('div');
		row.className = 'model-row-card';
		const reasoningChecked = m.reasoning ? 'checked' : '';
		const tf = (m.compat && m.compat.thinkingFormat) || '';
		row.innerHTML =
			'<div class="row-num">' + (idx + 1) + '</div>' +
			'<input type="text" placeholder="model-id" value="' + esc(m.id || '') + '" data-mp="' + esc(provName) + '" data-mi="' + idx + '" data-mf="id" />' +
			'<input type="text" placeholder="(optional)" value="' + esc(m.name || '') + '" data-mp="' + esc(provName) + '" data-mi="' + idx + '" data-mf="name" />' +
			'<label class="reasoning-cell" title="모델이 reasoning/thinking 출력을 지원하면 체크"><input type="checkbox" ' + reasoningChecked + ' data-mp="' + esc(provName) + '" data-mi="' + idx + '" data-mf="reasoning" /></label>' +
			// thinking-format dropdown only applies to reasoning models — hidden
			// (cell kept for grid alignment) until 추론 is checked.
			'<div class="tf-cell"><select title="thinking 토글 전송 형식 — 비워두면 provider 기준 자동 감지" data-mp="' + esc(provName) + '" data-mi="' + idx + '" data-mf="thinkingFormat"' + (m.reasoning ? '' : ' style="display:none"') + '>' + thinkingFormatOptionsHtml(tf) + '</select></div>' +
			'<button class="danger" data-del-model="' + esc(provName) + '" data-mi="' + idx + '" title="제거">✕</button>';
		container.appendChild(row);
	});
	container.querySelectorAll('[data-mf]').forEach((el) => {
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
				const sel = row && row.querySelector('select[data-mf="thinkingFormat"]');
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
	container.querySelectorAll('button[data-del-model]').forEach((btn) => {
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

function renderDiscoveryFor(container, provName) {
	const st = discoveryState[provName];
	container.innerHTML = '';
	if (!st) return;
	if (st.loading) {
		container.innerHTML = '<div class="disc-picker"><div class="disc-empty">모델 발견 중…</div></div>';
		return;
	}
	if (st.error) {
		container.innerHTML =
			'<div class="disc-picker"><div class="disc-empty" style="color: var(--vscode-errorForeground)">발견 실패: ' + esc(st.error) + '</div>' +
			'<div class="disc-footer"><button class="ghost" data-disc-close>닫기</button></div></div>';
		container.querySelector('button[data-disc-close]').addEventListener('click', () => {
			delete discoveryState[provName];
			renderProviders();
		});
		return;
	}
	const filtered = st.ids.filter((id) => !st.filter || id.toLowerCase().includes(st.filter.toLowerCase()));
	const cfg = modelsDraft.providers[provName];
	const existing = new Set(((cfg && cfg.models) || []).map((m) => m.id));

	const picker = document.createElement('div');
	picker.className = 'disc-picker';
	picker.innerHTML =
		'<div class="disc-header">' +
			'<div class="disc-title">' + st.ids.length + '개 모델 발견</div>' +
			'<div class="disc-actions">' +
				'<button data-disc-all>모두 선택</button>' +
				'<button data-disc-none>모두 선택 해제</button>' +
			'</div>' +
		'</div>' +
		'<input type="text" class="disc-search" placeholder="모델 검색…" value="' + esc(st.filter) + '" />' +
		'<div class="disc-list"></div>' +
		'<div class="disc-footer">' +
			'<button data-disc-add>' + st.selected.size + '개 모델 추가</button>' +
			'<button class="ghost" data-disc-close>취소</button>' +
		'</div>';
	container.appendChild(picker);
	const list = picker.querySelector('.disc-list');
	if (filtered.length === 0) {
		list.innerHTML = '<div class="disc-empty">검색 결과 없음</div>';
	} else {
		for (const id of filtered) {
			const item = document.createElement('label');
			item.className = 'disc-item';
			const isExisting = existing.has(id);
			item.innerHTML =
				'<input type="checkbox" ' + (st.selected.has(id) ? 'checked' : '') + (isExisting ? ' disabled' : '') + ' data-disc-id="' + esc(id) + '" />' +
				'<span>' + esc(id) + (isExisting ? ' <small style="color: var(--vscode-descriptionForeground)">(이미 등록됨)</small>' : '') + '</span>';
			list.appendChild(item);
		}
		list.querySelectorAll('input[data-disc-id]').forEach((cb) => {
			cb.addEventListener('change', () => {
				const id = cb.getAttribute('data-disc-id');
				if (cb.checked) st.selected.add(id);
				else st.selected.delete(id);
				picker.querySelector('button[data-disc-add]').textContent = st.selected.size + '개 모델 추가';
			});
		});
	}
	picker.querySelector('.disc-search').addEventListener('input', (ev) => {
		st.filter = ev.target.value;
		renderProviders();
		// Re-focus the search input after re-render
		setTimeout(() => {
			const newCard = document.querySelector('.provider-card[data-prov="' + CSS.escape(provName) + '"] .disc-search');
			if (newCard) {
				newCard.focus();
				newCard.setSelectionRange(st.filter.length, st.filter.length);
			}
		}, 0);
	});
	picker.querySelector('button[data-disc-all]').addEventListener('click', () => {
		for (const id of filtered) if (!existing.has(id)) st.selected.add(id);
		renderProviders();
	});
	picker.querySelector('button[data-disc-none]').addEventListener('click', () => {
		st.selected.clear();
		renderProviders();
	});
	picker.querySelector('button[data-disc-close]').addEventListener('click', () => {
		delete discoveryState[provName];
		renderProviders();
	});
	picker.querySelector('button[data-disc-add]').addEventListener('click', () => {
		if (!cfg) return;
		if (!cfg.models) cfg.models = [];
		const existingIds = new Set(cfg.models.map((m) => m.id));
		for (const id of st.selected) {
			if (!existingIds.has(id)) cfg.models.push({ id, name: '', contextWindow: '', maxTokens: '', reasoning: false });
		}
		showToast(st.selected.size + '개 모델 추가됨 (draft)');
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
	const replacements = [];
	const fixOne = (label, draft) => {
		if (!draft.provider || !draft.id) return;
		const entries = providerIndex.get(draft.provider) || [];
		if (entries.some((e) => e.id === draft.id)) return;
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
	for (const m of MODE_NAMES) fixOne(m + ' 모드', modesDraft[m] || { provider: '', id: '' });
	fixOne('자동 제목', autoTitleDraft);
	if (replacements.length) {
		showToast(replacements.length + '개 모델 자동 대체: ' + replacements[0]
			+ (replacements.length > 1 ? ' 외 ' + (replacements.length - 1) + '건' : ''));
	}
	return replacements.length > 0;
}

function renderAutoTitle() {
	const card = document.getElementById('autotitle-card');
	if (!card) return;
	card.classList.toggle('dirty', autoTitleDirty());
	const providerIndex = buildProviderIndex();
	const provSel = document.getElementById('autotitle-provider');
	const idSel = document.getElementById('autotitle-id');
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

function renderAllowlist() {
	const root = document.getElementById('allowlist-cards');
	if (!root) return;
	root.innerHTML = '';
	// Allowlist UI must show ALL models so the user can toggle them — pass
	// applyAllowlist=false so we don't filter out the very items being managed.
	const providerIndex = buildProviderIndex(false);
	const providers = [...providerIndex.keys()].sort();
	if (providers.length === 0) {
		root.innerHTML = '<div class="note">사용 가능한 모델이 아직 없습니다. 채팅 세션이 시작되면 자동으로 채워집니다.</div>';
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
					(filtered ? esc(String(allowed.size)) + ' / ' + entries.length + ' 노출' : '전체 ' + entries.length + ' 노출') +
				'</div>' +
				'<div class="provider-actions">' +
					'<button class="ghost" data-allow-all="' + esc(prov) + '">전체</button>' +
					'<button class="ghost" data-allow-none="' + esc(prov) + '">해제</button>' +
				'</div>' +
			'</div>' +
			'<div class="allowlist-grid" data-allow-grid="' + esc(prov) + '"></div>';
		root.appendChild(card);
		const grid = card.querySelector('[data-allow-grid]');
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
	root.querySelectorAll('input[type="checkbox"][data-allow-prov]').forEach((el) => {
		el.addEventListener('change', () => {
			const prov = el.getAttribute('data-allow-prov');
			const id = el.getAttribute('data-allow-id');
			if (!prov || !id) return;
			const entries = providerIndex.get(prov) || [];
			// Start from the current effective set (all visible if no filter).
			const current = Array.isArray(allowlistDraft[prov])
				? new Set(allowlistDraft[prov])
				: new Set(entries.map((e) => e.id));
			if (el.checked) current.add(id);
			else current.delete(id);
			// If user re-checked everything, drop the key entirely (= no filter).
			if (current.size === entries.length) delete allowlistDraft[prov];
			else allowlistDraft[prov] = [...current];
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
	root.querySelectorAll('button[data-allow-all]').forEach((btn) => {
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
	root.querySelectorAll('button[data-allow-none]').forEach((btn) => {
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

function render(s) {
	diskState = s;
	modesDraft = {};
	for (const n of MODE_NAMES) modesDraft[n] = diskMode(n);
	autoTitleDraft = diskAutoTitle();
	authAddsDraft = {};
	authRemovesDraft = new Set();
	modelsDraft = JSON.parse(JSON.stringify(diskModels()));
	allowlistDraft = JSON.parse(JSON.stringify(diskAllowlist()));

	renderModes();
	renderAutoTitle();
	renderAllowlist();
	renderAuth();
	renderProviders();
	updateSaveBar();
}

// Codex OAuth inline
// OAuth login buttons (Codex, Claude) share identical wiring; keyed by their
// status message kind so the status handler can find the right elements.
const oauthUis = {};
function wireOAuth(statusKind, btnId, cancelId, statusId, loginKind, cancelKind) {
	const btn = document.getElementById(btnId);
	const cancel = document.getElementById(cancelId);
	const status = document.getElementById(statusId);
	if (!btn || !cancel || !status) return;
	btn.addEventListener('click', () => {
		btn.disabled = true;
		cancel.classList.remove('hidden');
		status.textContent = '시작 중…';
		post({ kind: loginKind });
	});
	cancel.addEventListener('click', () => post({ kind: cancelKind }));
	oauthUis[statusKind] = { btn, cancel, status };
}
wireOAuth('codex-status', 'codex-login-btn', 'codex-cancel-btn', 'codex-status', 'codex-login', 'codex-login-cancel');
wireOAuth('anthropic-status', 'anthropic-login-btn', 'anthropic-cancel-btn', 'anthropic-status', 'anthropic-login', 'anthropic-login-cancel');

// Add auth (API key)
document.getElementById('add-auth-btn').addEventListener('click', () => {
	const id = document.getElementById('new-auth-id').value.trim();
	const key = document.getElementById('new-auth-key').value;
	if (!id || !key) { showToast('Provider id 와 API key 모두 입력해주세요.', true); return; }
	authAddsDraft[id] = key;
	document.getElementById('new-auth-id').value = '';
	document.getElementById('new-auth-key').value = '';
	renderAuth();
	updateSaveBar();
});

// Add custom provider — generate a unique placeholder name so the user can
// edit it inline (webview can't use window.prompt — it's blocked).
document.getElementById('add-provider-btn').addEventListener('click', () => {
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
		const newCard = document.querySelector('.provider-card[data-prov="' + CSS.escape(name) + '"]');
		if (newCard) {
			newCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
			const nameInput = newCard.querySelector('input[data-field="__name"]');
			if (nameInput) {
				nameInput.focus();
				nameInput.select();
			}
		}
	}, 50);
});

// Cancel
document.getElementById('cancel-btn').addEventListener('click', () => {
	if (!diskState) return;
	render(diskState);
	showToast('변경사항 취소됨');
});

// Save
document.getElementById('save-btn').addEventListener('click', () => {
	const payload = {
		kind: 'save',
		modes: true,
		modeConfigs: modesDraft,
		autoTitle: autoTitleDraft,
		modelAllowlist: allowlistDraft,
		authAdds: authAddsDraft,
		authRemoves: Array.from(authRemovesDraft),
		models: modelsDraft,
	};
	post(payload);
	showToast('저장 + 재로드 중…');
});

window.addEventListener('message', (ev) => {
	const msg = ev.data;
	if (!msg) return;
	if (msg.kind === 'state') render(msg.state);
	else if (msg.kind === 'error') showToast(msg.message || 'Error', true);
	else if (msg.kind === 'saved') showToast('저장됨: ' + (msg.files || []).join(', '));
	else if (msg.kind === 'codex-status' || msg.kind === 'anthropic-status') {
		const ui = oauthUis[msg.kind];
		if (!ui) return;
		const s = msg.state;
		if (s === 'success') {
			ui.btn.disabled = false;
			ui.cancel.classList.add('hidden');
			ui.status.textContent = '✓ ' + (msg.message || '완료');
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

post({ kind: 'refresh' });
