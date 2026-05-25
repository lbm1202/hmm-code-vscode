// Host → webview message router + Pi event handler + ui-hint handler.

import { appendSystem, els, setEmptyVisibility } from "./dom";
import { buildPlanExecutionBody, displayModel } from "./helpers";
import { clearConversation, renderHistory, renderRecentList } from "./history";
import { showModal } from "./modals";
import { updateModeColor } from "./pickers";
import {
	ASSISTANT_DELTA,
	FROM_WEBVIEW,
	PI_EVENT,
	STATUS_KEYS,
	TO_WEBVIEW,
} from "./protocol";
import {
	effectiveModel,
	pendingUiRequests,
	persistedSessionFile,
	post,
	rememberSessionFile,
	runtime,
	supportedThinkingLevels,
	ui,
} from "./state";
import { showSessionPicker } from "./session-picker";
import { addToolCall, updateToolPartial, updateToolResult } from "./tools";
import {
	ensureStatus,
	ensureTurn,
	finalizeBubble,
	finalizeTurn,
	pinStatusToEnd,
	setStatusPhase,
	streamText,
	streamThinking,
} from "./turn-lifecycle";
import type { ToWebview } from "./types";
import { updatePromptDisabled, updateResetVisibility, updateSendButton } from "./prompt";

/** Wire the window message listener. Call once at boot. */
export function wireDispatch(): void {
	window.addEventListener("message", (ev) => {
		const msg = ev.data as ToWebview;
		const handler = MESSAGE_HANDLERS[msg.kind];
		if (handler) handler(msg as any);
	});
}

/** Dispatch table for host → webview messages. */
const MESSAGE_HANDLERS: Record<string, (msg: any) => void> = {
	[TO_WEBVIEW.READY]: () => {
		setEmptyVisibility();
		pollInitialState();
		// Fetch full models list eagerly so we can backfill thinkingLevelMap/compat
		// for the active model if state.model is missing those fields.
		post({ kind: FROM_WEBVIEW.REQUEST_MODELS });
		post({ kind: FROM_WEBVIEW.REQUEST_CONTEXT });
		post({ kind: FROM_WEBVIEW.LIST_SESSIONS });
		// Auto-resume: if VS Code restored this webview after a reload, the
		// previous session file is in persisted state. Switch back to it so
		// the user picks up where they left off. Pi spawns a fresh session
		// by default; this transitions to the previous one once it's ready.
		const last = persistedSessionFile();
		if (last) {
			// Small delay so Pi's initial session bootstrap finishes before
			// we tell it to switch — racing it can cause "session not found"
			// errors on cold-start.
			setTimeout(() => {
				post({
					kind: FROM_WEBVIEW.COMMAND,
					command: { type: "switch_session", sessionPath: last },
				});
			}, 300);
		}
	},
	[TO_WEBVIEW.EVENT]: (msg) => handlePiEvent(msg.event),
	[TO_WEBVIEW.UI_REQUEST]: (msg) => showModal(msg.req),
	[TO_WEBVIEW.UI_HINT]: (msg) => handleHint(msg.hint),
	[TO_WEBVIEW.STATE]: (msg) => renderState(msg.state),
	[TO_WEBVIEW.SESSIONS]: (msg) => {
		ui.sessions = msg.sessions;
		renderRecentList();
		// If the session picker is currently open, re-render it so delete/rename
		// take effect immediately.
		if (els().modalRoot.querySelector(".session-tree")) {
			showSessionPicker(ui.sessions);
		}
	},
	[TO_WEBVIEW.MODELS]: (msg) => {
		ui.availableModels = msg.models;
		if (runtime.lastStateModel) {
			const eff = effectiveModel(runtime.lastStateModel);
			ui.availableThinking = supportedThinkingLevels(eff);
		}
	},
	[TO_WEBVIEW.MESSAGES]: (msg) => renderHistory(msg.messages),
	[TO_WEBVIEW.STDERR]: (msg) => appendSystem(msg.text),
	[TO_WEBVIEW.EXIT]: (msg) =>
		appendSystem(`Pi exited (code=${msg.code ?? "?"}, signal=${msg.signal ?? "?"})`),
};

/** Pi lifecycle / streaming event handler. */
function handlePiEvent(ev: any): void {
	const t = ev?.type;
	switch (t) {
		case PI_EVENT.MESSAGE_START: {
			if (ev.message?.role !== "assistant") return;
			ensureTurn();
			setStatusPhase("응답 생성 중");
			return;
		}
		case PI_EVENT.MESSAGE_UPDATE: {
			if (ev.message?.role && ev.message.role !== "assistant") return;
			const e = ev.assistantMessageEvent;
			if (!e) return;
			if (e.type === ASSISTANT_DELTA.TEXT) {
				streamText(String(e.delta ?? ""));
			} else if (e.type === ASSISTANT_DELTA.THINKING) {
				streamThinking(String(e.delta ?? ""));
			} else if (e.type === ASSISTANT_DELTA.TOOLCALL_END) {
				const tc = e.toolCall ?? {};
				addToolCall(
					String(tc.name ?? "?"),
					String(tc.id ?? e.contentIndex ?? Math.random()),
					tc.arguments,
				);
			}
			return;
		}
		case PI_EVENT.MESSAGE_END: {
			// Bubble is per-message. Status stays alive across messages so the
			// "도구 실행 중" indicator remains visible during tool gaps.
			finalizeBubble();
			post({ kind: FROM_WEBVIEW.REQUEST_STATE });
			return;
		}
		case PI_EVENT.SESSION_START:
		case PI_EVENT.SESSION_SWITCH:
		case PI_EVENT.SESSION_LOADED: {
			clearConversation();
			post({ kind: FROM_WEBVIEW.REQUEST_STATE });
			post({ kind: FROM_WEBVIEW.LIST_SESSIONS });
			post({ kind: FROM_WEBVIEW.REQUEST_CONTEXT });
			post({ kind: FROM_WEBVIEW.REQUEST_MESSAGES });
			// Plan handoff: if finalize_plan signaled a new-session implementation,
			// fire the implementation prompt now that the new session is ready.
			if (runtime.pendingPlanHandoff) {
				const { path, targetMode } = runtime.pendingPlanHandoff;
				runtime.pendingPlanHandoff = null;
				runPlanHandoff(path, targetMode);
			}
			return;
		}
		case PI_EVENT.TOOL_EXEC_START: {
			ensureStatus();
			setStatusPhase(`도구 실행 중 (${ev.toolName ?? "?"})`);
			return;
		}
		case PI_EVENT.TOOL_EXEC_UPDATE: {
			// Pi streams partial output for tools that support it (bash, etc.).
			updateToolPartial(String(ev.toolCallId ?? "?"), ev.partialResult);
			return;
		}
		case PI_EVENT.TOOL_EXEC_END: {
			const ok = !ev.error && !ev.isError;
			updateToolResult(String(ev.toolCallId ?? "?"), ok, ev.output ?? ev.result ?? ev.error);
			setStatusPhase("응답 대기 중");
			pinStatusToEnd();
			return;
		}
		case PI_EVENT.AGENT_START:
		case PI_EVENT.TURN_START:
			runtime.turnInFlight = true;
			updateSendButton();
			return;
		case PI_EVENT.AGENT_END:
		case PI_EVENT.TURN_END:
			runtime.turnInFlight = false;
			finalizeTurn();
			post({ kind: FROM_WEBVIEW.REQUEST_STATE });
			post({ kind: FROM_WEBVIEW.REQUEST_CONTEXT });
			return;
		case PI_EVENT.EXTENSION_ERROR:
			appendSystem(`[ext error ${ev.extensionPath ?? "?"} @ ${ev.event ?? "?"}] ${ev.error ?? ""}`);
			return;
	}
}

/** ui-hint handler (notify, setStatus, setTitle, set_editor_text). */
function handleHint(hint: any): void {
	const method = hint?.method;
	switch (method) {
		case "notify": {
			const m = String(hint.message ?? "");
			if (m) appendSystem(m);
			return;
		}
		case "setStatus":
			handleSetStatus(String(hint.statusKey ?? "").toLowerCase(), String(hint.statusText ?? ""));
			return;
		case "setTitle":
			document.title = String(hint.title ?? "Hmm-code");
			return;
		case "set_editor_text":
			els().prompt.value = String(hint.text ?? "");
			return;
	}
}

function handleSetStatus(key: string, value: string): void {
	const e = els();
	if (key === STATUS_KEYS.MODE) {
		ui.mode = value || "?";
		e.pickerModeLabel.textContent = ui.mode;
		updateModeColor();
	} else if (key === STATUS_KEYS.MODEL) {
		const next = value || "?";
		const changed = next !== ui.model;
		ui.model = next;
		e.pickerModelLabel.textContent = displayModel(value);
		// When the model changes (e.g. modes ext's state.apply runs setModel
		// after initial get_state), re-pull state so availableThinking gets
		// recomputed from the new full model object.
		if (changed) post({ kind: FROM_WEBVIEW.REQUEST_STATE });
	} else if (key === STATUS_KEYS.THINKING) {
		ui.thinking = value || "?";
		e.pickerThinkingLabel.textContent = ui.thinking;
	} else if (key === STATUS_KEYS.OVERRIDDEN) {
		runtime.isOverridden = value === "1";
		updateResetVisibility();
	} else if (key === STATUS_KEYS.CONTEXT || key === "ctx") {
		ui.context = value || "?";
		e.ctxPill.textContent = `ctx ${value}`;
	} else if (key === STATUS_KEYS.PLAN_HANDOFF) {
		// value format: "<planPath>|<targetMode>"
		const sep = value.lastIndexOf("|");
		const path = sep >= 0 ? value.slice(0, sep) : value;
		const targetMode = sep >= 0 ? value.slice(sep + 1) : "code";
		runtime.pendingPlanHandoff = { path, targetMode };
		appendSystem(`Plan saved → ${path}. Starting new ${targetMode} session…`);
		// Explicitly mark the new session as a child of the current plan session
		// so the picker tree shows the parent → code hand-off chain.
		post({
			kind: FROM_WEBVIEW.COMMAND,
			command: { type: "new_session", parentSession: runtime.currentSessionFile },
		});
	}
}

function pollInitialState(attempt = 0): void {
	if (runtime.initialStateReady || attempt > 10) return;
	post({ kind: FROM_WEBVIEW.REQUEST_STATE });
	setTimeout(() => pollInitialState(attempt + 1), 400);
}

function renderState(state: any): void {
	if (!state) return;
	const e = els();
	const m = state.model;
	if (m?.id) {
		runtime.lastStateModel = m;
		const eff = effectiveModel(m);
		// Raw identifiers used by the picker dropdown's "selected" comparison.
		// Do NOT touch pickerModelLabel here — setStatus("model") from Pi is
		// the authoritative source for the label (alias-aware). Overwriting
		// it with the raw id was clobbering aliases after every turn_end.
		ui.modelId = eff.id;
		ui.modelProvider = (eff.provider as string) ?? "";
		ui.availableThinking = supportedThinkingLevels(eff);
		if (eff.thinkingLevelMap !== undefined || eff.reasoning !== undefined) {
			runtime.initialStateReady = true;
		}
	}
	if (state.thinkingLevel) {
		ui.thinking = String(state.thinkingLevel);
		e.pickerThinkingLabel.textContent = ui.thinking;
	}
	if (typeof state.sessionFile === "string") {
		runtime.currentSessionFile = state.sessionFile;
		// Persist for auto-resume after window reload.
		rememberSessionFile(state.sessionFile);
	}
}

/** Async sequence: wait for session settle, switch mode if needed, fire plan body. */
async function runPlanHandoff(path: string, targetMode: string): Promise<void> {
	await delay(300);
	if (targetMode && targetMode !== ui.mode) {
		post({ kind: FROM_WEBVIEW.PROMPT, text: `/mode ${targetMode}` });
		await delay(200);
	}
	const body = buildPlanExecutionBody(path, targetMode);
	appendSystem(`Implementing plan from ${path}`);
	ensureTurn();
	post({ kind: FROM_WEBVIEW.PROMPT, text: body });
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// Re-export `updatePromptDisabled` so other modules can import from a single barrel.
export { updatePromptDisabled };
