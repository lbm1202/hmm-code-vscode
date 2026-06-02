// Webview global state. Two flavors:
//   - `ui` mirror: read-mostly snapshot of Pi-side state (mode/model/thinking
//     /context + available models/thinking) used by pickers and rendering.
//   - `runtime`: per-session UI flags (turnInFlight, status/bubble refs,
//     pendingQuestionCount, etc.) mutated by the dispatch + lifecycle modules.
// We export both as plain objects rather than passing them through every
// function call — keeps signatures readable in modules that need 4-5 of these.

import {
	BINARY_THINKING_FORMATS,
	THINKING_LEVELS,
} from "./protocol";
import type { SlashCommand } from "./protocol";
import type { BubbleState, ModelEntry, SessionEntry, StatusState } from "./types";

declare function acquireVsCodeApi(): {
	postMessage(msg: unknown): void;
	getState(): unknown;
	setState(state: unknown): unknown;
};
const vscode = acquireVsCodeApi();

/** Post a message to the host. */
export function post(msg: unknown): void {
	vscode.postMessage(msg);
}

// ── Persisted webview state (survives window reload via VS Code's
// serializer). Used to auto-resume the last active session on panel
// re-instantiation so the user doesn't lose their place. ─────────────
interface PersistedState {
	lastSessionFile?: string;
}
let _persisted: PersistedState = {};
try {
	const s = vscode.getState();
	if (s && typeof s === "object") _persisted = s as PersistedState;
} catch {
	/* getState may throw in older VS Codes — best-effort. */
}

export function persistedSessionFile(): string | undefined {
	return _persisted.lastSessionFile;
}

export function rememberSessionFile(file: string | undefined): void {
	if (_persisted.lastSessionFile === file) return;
	_persisted = { ..._persisted, lastSessionFile: file };
	try {
		vscode.setState(_persisted);
	} catch {
		/* setState may fail in older VS Codes — best-effort. */
	}
}

/** Mirror of Pi-side state. Updated by dispatch handlers.
 *  - model: DISPLAY label (alias-aware, from setStatus("model"))
 *  - modelId/modelProvider: RAW identifiers (from state.model in get_state)
 *    — used for picker "selected" comparison against availableModels. */
export const ui = {
	mode: "?" as string,
	model: "?" as string,
	modelId: "" as string,
	modelProvider: "" as string,
	thinking: "?" as string,
	context: "?" as string,
	availableModels: [] as ModelEntry[],
	availableThinking: [] as string[],
	/** True when the active model's thinking is binary (qwen/zai) — the picker
	 *  then shows off/on instead of the leveled list. */
	thinkingBinary: false,
	sessions: [] as SessionEntry[],
	/** Mirror of Pi's setStatus("auto-approve", "on"|"off"). Session-scoped. */
	autoApprove: false,
};

/** Per-session UI flags. */
export const runtime = {
	/** Between doSend/agent_start and agent_end/turn_end. Blocks prompt input. */
	turnInFlight: false,
	/** True while a compaction is in flight (compaction_start → compaction_end).
	 *  Blocks prompt input and hides the compact button. */
	compacting: false,
	/** Safety-timeout handle: releases the compaction lock if compaction_end never
	 *  arrives (failed / hung compaction). Cleared on compaction_end. */
	compactTimeout: null as number | null,
	/** Question card count; >0 blocks prompt input. */
	pendingQuestionCount: 0,
	/** Active status row (loading dots + phase text + elapsed). */
	status: null as StatusState | null,
	/** Active assistant bubble being streamed into. */
	bubble: null as BubbleState | null,
	/** Latest Pi-pushed overridden flag (setStatus("overridden", "0"|"1")). */
	isOverridden: false,
	/** Active session file path (from Pi's get_state). */
	currentSessionFile: undefined as string | undefined,
	/** Set while a switch_session command is in flight. Suppresses
	 * rememberSessionFile so the user's PREVIOUS session (the one we're
	 * switching TO) isn't overwritten by interim STATE messages reporting
	 * Pi's bootstrap temp session. Cleared when STATE arrives with this
	 * exact sessionFile. */
	pendingSwitchTarget: undefined as string | undefined,
	/** finalize_plan handoff queue: plan written, awaiting new session start. */
	pendingPlanHandoff: null as { path: string; targetMode: string } | null,
	/** Most recent state.model object — used to recompute thinking levels when
	 * the (delayed) full model list arrives. */
	lastStateModel: null as any,
	/** True once we've received a state with thinkingLevelMap/reasoning info. */
	initialStateReady: false,
	/** Registered slash commands (from the host's get_commands) for the prompt
	 *  autocomplete + clean-dispatch path. Empty until the host pushes them. */
	slashCommands: [] as SlashCommand[],
};

/** Outstanding UI requests (select/confirm/input/editor) by id. Survives
 * session-switch UI refreshes so a question card reappears when the user
 * comes back. Pi keeps the await pending under that id either way. */
export const pendingUiRequests = new Map<string, any>();

/** Expanded session-tree nodes — persists across re-renders of the picker. */
export const expandedSessions = new Set<string>();

/**
 * Mirrors `/mode-set` in modes/index.ts:
 *   - Reasoning-disabled → ["off"]
 *   - Binary-thinking provider (qwen-chat-template, zai) → off + lowest non-off
 *   - Otherwise → Pi's standard supportedThinkingLevels (include unmapped;
 *     exclude null-mapped; xhigh requires explicit mapping).
 */
export function supportedThinkingLevels(model: any): string[] {
	if (!model?.reasoning) return ["off"];
	const map = model.thinkingLevelMap ?? {};
	const standard = THINKING_LEVELS.filter((level) => {
		const mapped = (map as any)[level];
		if (mapped === null) return false;
		if (level === "xhigh") return mapped !== undefined;
		return true;
	});
	if (isBinaryThinking(model)) {
		// Binary providers (qwen/zai) only honor enable_thinking on/off — any
		// non-off level collapses to the same thing. Show off + a single canonical
		// "on" level. Most such models have NO thinkingLevelMap, so don't gate on
		// an explicit entry (that was the bug); default the on-level to medium,
		// matching the Alt+T toggle.
		const explicitNonOff = THINKING_LEVELS.find(
			(l) => l !== "off" && (map as any)[l] !== undefined && (map as any)[l] !== null,
		);
		return ["off", explicitNonOff ?? "medium"];
	}
	return [...standard];
}

/** Whether the model's thinking is binary (on/off) rather than leveled —
 *  reasoning model served via a qwen/zai-style enable_thinking flag. */
export function isBinaryThinking(model: any): boolean {
	if (!model?.reasoning) return false;
	const fmt = model?.compat?.thinkingFormat;
	return !!fmt && BINARY_THINKING_FORMATS.has(fmt);
}

/** Footer label for the current thinking state — on/off for binary models,
 *  the raw level otherwise. */
export function thinkingLabel(): string {
	if (ui.thinkingBinary) return ui.thinking === "off" ? "off" : "on";
	return ui.thinking;
}

/** Backfill missing fields on the live state.model from the full models list. */
export function effectiveModel(m: any): any {
	const full = ui.availableModels.find((x) => x.provider === m?.provider && x.id === m?.id);
	if (!full) return m;
	return {
		...full,
		...m,
		thinkingLevelMap: m.thinkingLevelMap ?? full.thinkingLevelMap,
		reasoning: m.reasoning ?? full.reasoning,
		compat: m.compat ?? full.compat,
	};
}
