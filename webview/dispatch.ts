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
		else console.warn("[hmm-code] unhandled host→webview message kind:", msg?.kind);
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
			// Set the guard BEFORE the setTimeout so any STATE message that
			// arrives in the 300ms window (reporting Pi's bootstrap temp
			// session) won't overwrite `last` in persisted storage. Cleared
			// in renderState when the target session reports back.
			runtime.pendingSwitchTarget = last;
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
	[TO_WEBVIEW.EXIT]: (msg) => {
		appendSystem(`Pi exited (code=${msg.code ?? "?"}, signal=${msg.signal ?? "?"})`);
		// A crash/exit mid-turn would otherwise strand the optimistic loading
		// spinner — end the turn so the input is usable again.
		runtime.turnInFlight = false;
		finalizeTurn();
	},
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
		default:
			// Unknown Pi event type — surfaces protocol drift during dev instead
			// of dropping silently. Harmless events (many) land here too.
			if (t) console.debug("[hmm-code] unhandled pi event:", t);
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
		default:
			if (method) console.warn("[hmm-code] unhandled ui-hint method:", method);
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
	} else if (key === STATUS_KEYS.AUTO_APPROVE) {
		ui.autoApprove = value === "on" || value === "true" || value === "1";
		const btn = e.btnAutoApprove;
		btn.classList.toggle("on", ui.autoApprove);
		btn.classList.toggle("off", !ui.autoApprove);
		btn.textContent = ui.autoApprove ? "🔓 Auto" : "🔒 Auto";
		btn.title = ui.autoApprove
			? "권한 ask 자동승인 켜짐 — 클릭해서 끄기"
			: "권한 ask 자동승인 꺼짐 — 클릭해서 켜기";
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
	} else if (key === STATUS_KEYS.TODOS) {
		// Received from Pi's todo_write, but todos render from the todo_write
		// tool-call result (see tools.ts), not this status channel. Acknowledge
		// so it doesn't trip the unknown-key warning below.
	} else if (key) {
		console.warn("[hmm-code] unhandled setStatus key:", key);
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
		// Guard against the auto-resume race: while a switch_session is in
		// flight, Pi's bootstrap temp session may report here first and
		// silently overwrite the user's previous session in persisted storage,
		// breaking auto-resume on the next reload. Skip until the target lands.
		if (runtime.pendingSwitchTarget) {
			if (state.sessionFile === runtime.pendingSwitchTarget) {
				runtime.pendingSwitchTarget = undefined;
				rememberSessionFile(state.sessionFile);
			}
		} else {
			rememberSessionFile(state.sessionFile);
		}
	}
}

/** Async sequence: wait for session settle, switch mode if needed, fire plan body.
 *  Mode-switch wait is condition-based (poll ui.mode until it matches), with a
 *  hard ceiling — replaces the fixed 200ms delay that could let the body fire
 *  before Pi finished applying the mode under load. */
async function runPlanHandoff(path: string, targetMode: string): Promise<void> {
	await delay(300);
	if (targetMode && targetMode !== ui.mode) {
		post({ kind: FROM_WEBVIEW.PROMPT, text: `/mode ${targetMode}` });
		await waitFor(() => ui.mode === targetMode, 2000);
		if (ui.mode !== targetMode) {
			appendSystem(
				`Warning: mode did not settle to "${targetMode}" within 2s; sending plan anyway.`,
			);
		}
	}
	const body = buildPlanExecutionBody(path, targetMode);
	appendSystem(`Implementing plan from ${path}`);
	ensureTurn();
	post({ kind: FROM_WEBVIEW.PROMPT, text: body });
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Poll predicate every 50ms up to timeoutMs. Returns when true or timeout. */
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (!pred() && Date.now() - start < timeoutMs) {
		await delay(50);
	}
}

