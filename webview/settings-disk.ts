import { S, MODE_NAMES, el, t } from "./settings-state";

export function diskMode(name: any) {
	const cfg = (S.diskState && S.diskState.modes && S.diskState.modes.modes && S.diskState.modes.modes[name]) || {};
	const m = cfg.model;
	const isObj = m && typeof m === 'object';
	return {
		provider: isObj ? (m.provider || '') : '',
		id: isObj ? (m.id || '') : '',
		thinking: cfg.thinkingLevel || '',
		promptOverride: cfg.systemPromptAddendum || '',
	};
}
export function defaultPrompt(name: any) {
	return (S.diskState && S.diskState.defaultPrompts && S.diskState.defaultPrompts[name]) || '';
}
export function diskAuth() { return (S.diskState && S.diskState.auth) || {}; }
export function diskModels() {
	const m = S.diskState && S.diskState.models;
	return (m && typeof m === 'object' && m.providers) ? m : { providers: {} };
}

export function modeDirty(name: any) {
	const d = diskMode(name);
	const draft = S.modesDraft[name] || { provider: '', id: '', thinking: '', prompt: '' };
	const def = defaultPrompt(name);
	// Treat "prompt identical to default" as no override.
	const draftOverride = (draft.prompt || '') === def ? '' : (draft.prompt || '');
	return d.provider !== draft.provider || d.id !== draft.id || d.thinking !== draft.thinking
		|| draftOverride !== d.promptOverride;
}
export function authDirty() {
	return Object.keys(S.authAddsDraft).length > 0 || S.authRemovesDraft.size > 0;
}
export function modelsDirty() {
	return JSON.stringify(S.modelsDraft) !== JSON.stringify(diskModels());
}

export function diskAutoTitle() {
	const a = S.diskState && S.diskState.modes && S.diskState.modes.autoTitle;
	return {
		provider: (a && a.provider) || '',
		id: (a && a.id) || '',
	};
}
export function autoTitleDirty() {
	const d = diskAutoTitle();
	return d.provider !== S.autoTitleDraft.provider || d.id !== S.autoTitleDraft.id;
}
export function diskCompactModel() {
	const a = S.diskState && S.diskState.modes && S.diskState.modes.compactModel;
	return {
		provider: (a && a.provider) || '',
		id: (a && a.id) || '',
	};
}
export function compactModelDirty() {
	const d = diskCompactModel();
	return d.provider !== S.compactModelDraft.provider || d.id !== S.compactModelDraft.id;
}

export function diskAllowlist() {
	const a = S.diskState && S.diskState.modelAllowlist;
	return (a && typeof a === 'object') ? a : {};
}
export function allowlistDirty() {
	// Preserve empty arrays — they mean "explicitly hide all from this provider",
	// distinct from a missing key which means "no filter".
	const norm = (obj: any) => {
		const out: Record<string, any> = {};
		for (const [k, v] of Object.entries(obj || {})) {
			if (Array.isArray(v)) out[k] = v.slice().sort();
		}
		return out;
	};
	return JSON.stringify(norm(S.allowlistDraft)) !== JSON.stringify(norm(diskAllowlist()));
}

export function diskCompactOverride() {
	return (S.diskState && typeof S.diskState.autoCompactThreshold === 'number') ? S.diskState.autoCompactThreshold : null;
}
export function defaultCompact() {
	return (S.diskState && typeof S.diskState.defaultCompactThreshold === 'number') ? S.diskState.defaultCompactThreshold : 75;
}
export function compactDirty() {
	// Treat "equal to default" as no override.
	const def = defaultCompact();
	const n = parseInt(S.compactDraft, 10);
	const draftOverride = (!Number.isFinite(n) || n === def) ? null : n;
	return draftOverride !== diskCompactOverride();
}
export function diskDynamicCompaction() {
	return (S.diskState && typeof S.diskState.dynamicCompaction === 'boolean') ? S.diskState.dynamicCompaction : true;
}
export function dynamicCompactionDirty() {
	return S.dynamicCompactionDraft !== diskDynamicCompaction();
}
export function diskAutoTitlePrompt() {
	const v = S.diskState && S.diskState.modes && S.diskState.modes.autoTitlePrompt;
	return typeof v === 'string' ? v : '';
}
export function defaultAutoTitle() {
	return (S.diskState && typeof S.diskState.defaultAutoTitlePrompt === 'string') ? S.diskState.defaultAutoTitlePrompt : '';
}
// The auto-title editor is pre-filled with the built-in default; an override is
// only stored when the text differs from it (mirrors the per-mode prompts).
export function autoTitleOverrideFromDraft() {
	const d = S.autoTitlePromptDraft.trim();
	return (d === '' || d === defaultAutoTitle().trim()) ? '' : S.autoTitlePromptDraft;
}
export function diskCompactInstructions() {
	const v = S.diskState && S.diskState.modes && S.diskState.modes.compactInstructions;
	return typeof v === 'string' ? v : '';
}
export function autoTitlePromptDirty() {
	return autoTitleOverrideFromDraft().trim() !== diskAutoTitlePrompt().trim();
}
export function compactInstructionsDirty() {
	return S.compactInstructionsDraft.trim() !== diskCompactInstructions().trim();
}

export function isDirty() {
	if (!S.diskState) return false;
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

export function updateSaveBar() {
	const dirty = isDirty();
	el('save-bar').classList.toggle('hidden', !dirty);
	if (!dirty) return;
	let modeD = 0, authD = 0;
	for (const n of MODE_NAMES) if (modeDirty(n)) modeD++;
	authD = Object.keys(S.authAddsDraft).length + S.authRemovesDraft.size;
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
