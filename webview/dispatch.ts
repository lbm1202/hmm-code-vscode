// Host → webview message router + Pi event handler + ui-hint handler.

import { appendCompactionSummary, appendSystem, els, setEmptyVisibility } from "./dom";
import { buildPlanExecutionBody, buildReviewBody } from "./helpers";
import { clearConversation, renderHistory, renderRecentList } from "./history";
import { showModal } from "./modals";
import { t } from "./i18n";
import { refreshPopover, updateModeChipTitle, updateModeColor } from "./pickers";
import {
	ASSISTANT_DELTA,
	FROM_WEBVIEW,
	PI_EVENT,
	STATUS_KEYS,
	TO_WEBVIEW,
} from "./protocol";
import {
	effectiveModel,
	isBinaryThinking,
	pendingUiRequests,
	persistedSessionFile,
	post,
	rememberSessionFile,
	runtime,
	supportedThinkingLevels,
	todoPanelEnabled,
	ui,
} from "./state";
import { showSessionPicker } from "./session-picker";
import { renderSubUsage } from "./sub-usage-modal";
import { showTokenModal } from "./token-modal";
import { updateTodoPanel } from "./todo-panel";
import { addToolCall, updateToolPartial, updateToolResult } from "./tools";
import {
	ensureStatus,
	ensureTurn,
	finalizeBubble,
	finalizeTurn,
	pinStatusToEnd,
	setStatusPhase,
	settleThinking,
	streamText,
	streamThinking,
} from "./turn-lifecycle";
import type { ToWebview } from "./types";
import { updatePromptDisabled, updateSendButton } from "./prompt";

// hmm-code.autoApproveDefault — injected by the host into window.__HMM_CFG
// (see chat-backend renderChatHtml). When true, freshly started/resumed
// sessions force permission auto-approve ON.
const autoApproveDefault = !!(
	window as unknown as { __HMM_CFG?: { autoApproveDefault?: boolean } }
).__HMM_CFG?.autoApproveDefault;

/** Release the compaction input-lock after this long if compaction_end never
 *  arrives — a real summary completes well under this; a hang/failure is caught. */
const COMPACT_TIMEOUT_MS = 240_000;

/** Auto-resume runs once per webview load. READY can fire twice (the host's eager
 *  READY plus the WEBVIEW_READY handshake reply); the data requests are idempotent
 *  but a double switch_session is not, so guard it. */
let bootResumeDone = false;

/** Show the compact button only when it's actually usable: enough context to be
 *  worth compacting (≥35% usage), the chat is idle (no turn in flight — Pi can't
 *  compact mid-turn anyway), and no compaction is already running. Reads the last
 *  known context % from `ui.context`. Called on every relevant transition. */
function refreshCompactBtn(): void {
	const pct = parseFloat(ui.context || "");
	els().btnCompact.classList.toggle(
		"hidden",
		runtime.compacting || runtime.turnInFlight || !(Number.isFinite(pct) && pct >= 35),
	);
}

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
		post({ kind: FROM_WEBVIEW.REQUEST_COMMANDS });
		post({ kind: FROM_WEBVIEW.LIST_SESSIONS });
		// Auto-resume: if VS Code restored this webview after a reload, the
		// previous session file is in persisted state. Switch back to it so
		// the user picks up where they left off. Pi spawns a fresh session
		// by default; this transitions to the previous one once it's ready.
		const last = bootResumeDone ? null : persistedSessionFile();
		if (last) {
			bootResumeDone = true;
			// Set the guard BEFORE switching so any STATE reporting Pi's bootstrap
			// temp session won't overwrite `last` in persisted storage. Cleared in
			// renderState when the target session reports back.
			runtime.pendingSwitchTarget = last;
			void resumeLastSession(last);
		}
	},
	[TO_WEBVIEW.EVENT]: (msg) => handlePiEvent(msg.event),
	[TO_WEBVIEW.UI_REQUEST]: (msg) => showModal(msg.req),
	[TO_WEBVIEW.UI_HINT]: (msg) => handleHint(msg.hint),
	[TO_WEBVIEW.STATE]: (msg) => renderState(msg.state),
	[TO_WEBVIEW.SESSIONS]: (msg) => {
		ui.sessions = msg.sessions;
		renderRecentList();
		// If the session picker is open (incl. its loading/empty state), re-render
		// it so the fresh list, delete, and rename take effect in place. Match the
		// stable `.session-picker` marker, not `.session-tree` — the loading state
		// has no tree yet but must still be replaced when the list arrives.
		if (els().modalRoot.querySelector(".session-picker")) {
			showSessionPicker(ui.sessions);
		}
	},
	[TO_WEBVIEW.MODELS]: (msg) => {
		ui.availableModels = msg.models;
		if (runtime.lastStateModel) {
			const eff = effectiveModel(runtime.lastStateModel);
			ui.availableThinking = supportedThinkingLevels(eff);
			ui.thinkingBinary = isBinaryThinking(eff);
		}
		refreshPopover(); // populate an open Model tab once the list arrives
	},
	[TO_WEBVIEW.MESSAGES]: (msg) => renderHistory(msg.messages, msg.stats),
	[TO_WEBVIEW.COMMANDS]: (msg) => {
		// stats-record is the webview's own machine-dispatched bridge (stats →
		// session entry) — hide it from the user-facing autocomplete.
		runtime.slashCommands = (msg.commands ?? []).filter(
			(c: { name: string }) => c.name !== "stats-record",
		);
	},
	[TO_WEBVIEW.USAGE]: (msg) => showTokenModal(msg.perModel ?? {}, msg.sessionCount ?? 1, msg.context),
	[TO_WEBVIEW.SUB_USAGE]: (msg) => renderSubUsage(msg),
	[TO_WEBVIEW.STDERR]: (msg) => appendSystem(msg.text),
	[TO_WEBVIEW.EXIT]: (msg) => {
		appendSystem(`Pi exited (code=${msg.code ?? "?"}, signal=${msg.signal ?? "?"})`);
		// Pi died — EVERY in-flight thing on it (the turn, a compaction, any pending
		// ask_user/confirm whose await lived in that process) is now dead. Reset all
		// input-gating state so the chat is usable again after the host respawns Pi;
		// otherwise a crash mid-compaction or mid-question leaves input permanently
		// disabled (the 240s compaction timer / the pendingQuestionCount never clear).
		runtime.turnInFlight = false;
		runtime.compacting = false;
		if (runtime.compactTimeout != null) {
			clearTimeout(runtime.compactTimeout);
			runtime.compactTimeout = null;
		}
		pendingUiRequests.clear();
		runtime.pendingQuestionCount = 0;
		finalizeTurn();
		updatePromptDisabled();
	},
};

/** Pi lifecycle / streaming event handler. */
function handlePiEvent(ev: any): void {
	// NOTE: do NOT name this `t` — it would shadow the imported i18n `t()` for the
	// whole function, turning every `t("…")` call here into "<eventType>(…)" → a
	// "t is not a function" TypeError. That latent bug silently broke status-phase
	// strings and (visibly) the compaction lock's pill/updatePromptDisabled.
	const evType = ev?.type;
	switch (evType) {
		case PI_EVENT.MESSAGE_START: {
			if (ev.message?.role !== "assistant") return;
			ensureTurn();
			setStatusPhase(t("chat.status.generating"));
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
				// A tool call after reasoning also ends the thinking phase (some
				// messages go thinking → tool with no visible text in between).
				settleThinking();
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
			// A turn that errored (e.g. provider 400/401, rate/usage limit) comes
			// back as an assistant message with stopReason "error" and empty
			// content — which would otherwise render as a blank bubble (user sees
			// nothing). Surface the provider's reason instead.
			const m = ev.message;
			if (m?.role === "assistant" && (m.stopReason === "error" || m.errorMessage)) {
				appendSystem("⚠️ " + formatTurnError(m.errorMessage));
			}
			// Bubble is per-message. Status stays alive across messages so the
			// "tool running" indicator remains visible during tool gaps. The
			// message carries usage (tokens) for the per-message stats toggle.
			finalizeBubble(m);
			// The next API round (if any) starts after this point.
			runtime.requestMarkAt = Date.now();
			post({ kind: FROM_WEBVIEW.REQUEST_STATE });
			return;
		}
		case PI_EVENT.QUEUE_UPDATE: {
			// A steering/follow-up message left the queue → it was delivered into
			// the conversation; un-dim its bubble. (Texts still listed stay dimmed.)
			const still = new Set<string>([
				...((ev.steering as string[]) ?? []),
				...((ev.followUp as string[]) ?? []),
			]);
			runtime.steerQueue = runtime.steerQueue.filter((q) => {
				if (still.has(q.text)) return true;
				q.el.classList.remove("queued");
				q.el.removeAttribute("title");
				return false;
			});
			return;
		}
		case PI_EVENT.SESSION_START:
		case PI_EVENT.SESSION_SWITCH:
		case PI_EVENT.SESSION_LOADED: {
			clearConversation();
			runtime.steerQueue = []; // bubbles are gone with the conversation
			post({ kind: FROM_WEBVIEW.REQUEST_STATE });
			post({ kind: FROM_WEBVIEW.LIST_SESSIONS });
			post({ kind: FROM_WEBVIEW.REQUEST_CONTEXT });
			post({ kind: FROM_WEBVIEW.REQUEST_MESSAGES });
			// Backfill the slash-command list if the READY-time fetch hasn't
			// landed yet (cold-session race) so the prompt autocomplete works.
			if (!runtime.slashCommands.length) post({ kind: FROM_WEBVIEW.REQUEST_COMMANDS });
			// hmm-code.autoApproveDefault: the user opted into auto-approve as a
			// default, so (re)assert it ON whenever a session starts or loads
			// (new session + boot-resume). SESSION_SWITCH is excluded to avoid
			// re-enabling on every navigation between existing sessions.
			// `/auto-approve on` is idempotent, so a redundant send is harmless.
			if (
				autoApproveDefault &&
				(ev.type === PI_EVENT.SESSION_START || ev.type === PI_EVENT.SESSION_LOADED)
			) {
				post({ kind: FROM_WEBVIEW.SLASH, text: "/auto-approve on" });
			}
			// Plan handoff: if finalize_plan signaled a new-session implementation,
			// fire the implementation prompt now that the new session is ready.
			if (runtime.pendingPlanHandoff) {
				const { path, targetMode } = runtime.pendingPlanHandoff;
				runtime.pendingPlanHandoff = null;
				runPlanHandoff(path, targetMode);
			}
			// Review handoff: finalize_implementation signaled completion and we
			// switched back to the parent plan session — enter review mode there.
			if (runtime.pendingReviewHandoff) {
				const { reportPath } = runtime.pendingReviewHandoff;
				runtime.pendingReviewHandoff = null;
				void runReviewHandoff(reportPath, false);
			}
			return;
		}
		case PI_EVENT.TOOL_EXEC_START: {
			ensureStatus();
			setStatusPhase(t("chat.status.toolRunning", { tool: String(ev.toolName ?? "?") }));
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
			setStatusPhase(t("chat.status.waiting"));
			pinStatusToEnd();
			// The follow-up API request starts right after the tool finishes —
			// baseline for the next message's ttft.
			runtime.requestMarkAt = Date.now();
			return;
		}
		case PI_EVENT.AGENT_START:
		case PI_EVENT.TURN_START:
			runtime.turnInFlight = true;
			// First API request of the turn starts now. A fresh (<5s) mark from
			// doSend is MORE accurate (set before the RPC round-trip) — keep it;
			// anything older is a stale leftover (auto-dispatched turns —
			// handoffs, auto-continue — never pass through doSend).
			if (Date.now() - runtime.requestMarkAt > 5_000) {
				runtime.requestMarkAt = Date.now();
			}
			updateSendButton();
			// Hide the compact button immediately while the model works (a turn can
			// span multiple tool rounds; Pi can't compact until it ends).
			refreshCompactBtn();
			// Refresh the context pill: if a just-finished compaction left it
			// reading "compacted", the new turn restores the live % here.
			post({ kind: FROM_WEBVIEW.REQUEST_CONTEXT });
			return;
		case PI_EVENT.AGENT_END:
		case PI_EVENT.TURN_END:
			runtime.turnInFlight = false;
			// Any steering bubble still dimmed here was either delivered without
			// a queue_update or dropped by an abort — stop showing it as pending.
			for (const q of runtime.steerQueue) {
				q.el.classList.remove("queued");
				q.el.removeAttribute("title");
			}
			runtime.steerQueue = [];
			finalizeTurn();
			post({ kind: FROM_WEBVIEW.REQUEST_STATE });
			post({ kind: FROM_WEBVIEW.REQUEST_CONTEXT });
			return;
		case PI_EVENT.COMPACTION_START:
			// Lock input while compacting (same mechanism as a turn). compaction_start
			// reliably reaches here; the earlier failure was the shadowed `t` above.
			runtime.compacting = true;
			// `status` hides the "ctx" prefix while the pill shows a status word
			// (set the value span, never ctxPill.textContent — that would drop the
			// prefix/value child spans the live-% path relies on).
			els().ctxPill.classList.add("status");
			els().ctxValue.textContent = t("chat.compacting");
			// Hide the compact button while compacting; refreshCompactBtn re-shows it
			// once context climbs back over the threshold on a later turn.
			refreshCompactBtn();
			updatePromptDisabled();
			// Safety: if compaction_end never arrives (failed / hung compaction),
			// release the lock so the chat doesn't stay frozen forever.
			if (runtime.compactTimeout != null) clearTimeout(runtime.compactTimeout);
			runtime.compactTimeout = window.setTimeout(() => {
				runtime.compactTimeout = null;
				if (!runtime.compacting) return;
				runtime.compacting = false;
				appendSystem(t("chat.compactTimeout"));
				updatePromptDisabled();
				post({ kind: FROM_WEBVIEW.REQUEST_CONTEXT });
			}, COMPACT_TIMEOUT_MS);
			return;
		case PI_EVENT.COMPACTION_END:
			if (runtime.compactTimeout != null) {
				clearTimeout(runtime.compactTimeout);
				runtime.compactTimeout = null;
			}
			runtime.compacting = false;
			if (ev.aborted) {
				// Aborted/failed — restore the real % instead of claiming success.
				post({ kind: FROM_WEBVIEW.REQUEST_CONTEXT });
			} else {
				// Show "compacted" until the next turn refreshes the live %.
				els().ctxPill.classList.add("status");
				els().ctxValue.textContent = t("chat.compacted");
				appendCompactionSummary(typeof ev.result?.summary === "string" ? ev.result.summary : "");
			}
			updatePromptDisabled();
			return;
		case PI_EVENT.EXTENSION_ERROR:
			appendSystem(`[ext error ${ev.extensionPath ?? "?"} @ ${ev.event ?? "?"}] ${ev.error ?? ""}`);
			return;
		default:
			// Unknown Pi event type — surfaces protocol drift during dev instead
			// of dropping silently. Harmless events (many) land here too.
			if (evType) console.debug("[hmm-code] unhandled pi event:", evType);
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

// A mode switch emits several mode/overridden statuses in quick succession
// (the modes ext applies model + thinking, with transient values in between),
// and rapid switching can deliver them out of order. Debounce the chip + reset
// button so only the SETTLED value renders — otherwise the label flickers and
// the reset button flashes. The click handler already updated the chip
// optimistically, so this is just confirmation of the final state.
let modeSettleTimer: ReturnType<typeof setTimeout> | undefined;
let overriddenSettleTimer: ReturnType<typeof setTimeout> | undefined;

function handleSetStatus(key: string, value: string): void {
	const e = els();
	if (key === STATUS_KEYS.MODE) {
		ui.mode = value || "?";
		clearTimeout(modeSettleTimer);
		modeSettleTimer = setTimeout(() => {
			els().pickerModeLabel.textContent = ui.mode;
			updateModeColor();
		}, 120);
	} else if (key === STATUS_KEYS.MODEL) {
		const next = value || "?";
		const changed = next !== ui.model;
		ui.model = next;
		updateModeChipTitle(); // hover tooltip shows the live model
		refreshPopover(); // keep an open Model tab's selection in sync
		// When the model changes (e.g. modes ext's state.apply runs setModel
		// after initial get_state), re-pull state so availableThinking gets
		// recomputed from the new full model object.
		if (changed) post({ kind: FROM_WEBVIEW.REQUEST_STATE });
	} else if (key === STATUS_KEYS.THINKING) {
		ui.thinking = value || "?";
		updateModeChipTitle();
		refreshPopover(); // keep an open Effort slider in sync
	} else if (key === STATUS_KEYS.OVERRIDDEN) {
		runtime.isOverridden = value === "1";
		clearTimeout(overriddenSettleTimer);
		overriddenSettleTimer = setTimeout(() => {
			els().btnReset.classList.toggle("hidden", !runtime.isOverridden);
		}, 120);
	} else if (key === STATUS_KEYS.AUTO_APPROVE) {
		// State only — surfaced as a toggle row in the mode popover (pickers.ts).
		ui.autoApprove = value === "on" || value === "true" || value === "1";
	} else if (key === STATUS_KEYS.CONTEXT || key === "ctx") {
		ui.context = value || "?";
		e.ctxValue.textContent = value;
		e.ctxPill.classList.remove("status");
		refreshCompactBtn();
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
	} else if (key === STATUS_KEYS.REVIEW_HANDOFF) {
		// value format: "<reportPath>|<parentSessionPath or empty>". Pi resolves
		// the parent from the child session's header (recorded at plan handoff),
		// so this survives webview reloads between handoff and completion.
		const sep = value.lastIndexOf("|");
		const reportPath = sep >= 0 ? value.slice(0, sep) : value;
		const parentPath = sep >= 0 ? value.slice(sep + 1) : "";
		if (parentPath && parentPath !== runtime.currentSessionFile) {
			appendSystem(`Implementation report → ${reportPath}. Reviewing in the plan session…`);
			runtime.pendingReviewHandoff = { reportPath };
			// Same guard as auto-resume: don't let interim STATE messages persist
			// a transient session while the switch is in flight.
			runtime.pendingSwitchTarget = parentPath;
			post({
				kind: FROM_WEBVIEW.COMMAND,
				command: { type: "switch_session", sessionPath: parentPath },
			});
		} else {
			// No recorded parent (standalone code session, deleted parent) —
			// review in place in this session.
			appendSystem(`Implementation report → ${reportPath}. Switching to review…`);
			void runReviewHandoff(reportPath, true);
		}
	} else if (key === STATUS_KEYS.TODOS) {
		// Full task list pushed by Pi's todo_write. When the pinned panel is on,
		// drive it from here (the in-stream block then collapses to one line; see
		// updateToolResult). When off, this stays a no-op and the full list
		// renders inline as before.
		if (todoPanelEnabled) {
			try {
				const parsed = JSON.parse(value);
				if (parsed && Array.isArray(parsed.todos)) updateTodoPanel(parsed.todos);
			} catch {
				/* malformed status payload — ignore */
			}
		}
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
		ui.thinkingBinary = isBinaryThinking(eff);
		if (eff.thinkingLevelMap !== undefined || eff.reasoning !== undefined) {
			runtime.initialStateReady = true;
		}
	}
	if (state.thinkingLevel) {
		ui.thinking = String(state.thinkingLevel);
	}
	// A model switch lands its thinking levels here (async, after set_model).
	// Refresh any open popover so the Effort slider reflects the new model
	// immediately instead of needing a second click.
	refreshPopover();
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

/** Auto-resume the last session after a webview reload. Gates on Pi readiness
 *  (the first get_state landing — switching during Pi's session bootstrap returns
 *  "session not found") instead of a blind fixed delay, retries a few times, and
 *  on give-up clears pendingSwitchTarget so renderState resumes persisting the
 *  actual active session (otherwise auto-resume stays broken for the rest of this
 *  webview's life). Covers M-1 (race) + M-3 (latched guard). */
async function resumeLastSession(target: string): Promise<void> {
	// pollInitialState (fired from READY) is already polling get_state;
	// runtime.currentSessionFile is set by renderState on the first response —
	// that's the "Pi is ready to accept session commands" signal.
	await waitFor(() => !!runtime.currentSessionFile, 5000);
	for (let attempt = 0; attempt < 3; attempt++) {
		if (runtime.pendingSwitchTarget !== target) return; // already switched
		post({
			kind: FROM_WEBVIEW.COMMAND,
			command: { type: "switch_session", sessionPath: target },
		});
		// renderState clears pendingSwitchTarget once state.sessionFile === target.
		await waitFor(() => runtime.pendingSwitchTarget !== target, 4000);
		if (runtime.pendingSwitchTarget !== target) return; // success
	}
	// Gave up — unstick the guard so rememberSessionFile resumes on the next STATE.
	if (runtime.pendingSwitchTarget === target) runtime.pendingSwitchTarget = undefined;
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

/** Async sequence for the implementation→review handoff: switch to review mode
 *  (in the parent plan session after the session switch settles, or in place
 *  when there is no parent), then fire the review prompt referencing the
 *  implementation report. Mirrors runPlanHandoff's condition-based waits. */
async function runReviewHandoff(reportPath: string, sameSession: boolean): Promise<void> {
	await delay(300);
	if (ui.mode !== "review") {
		// /review-begin (not /mode review): Pi remembers the prior mode and
		// auto-returns to it once the review reply's turn ends.
		post({ kind: FROM_WEBVIEW.PROMPT, text: "/review-begin" });
		await waitFor(() => ui.mode === "review", 2000);
		if (ui.mode !== "review") {
			appendSystem(`Warning: mode did not settle to "review" within 2s; sending review request anyway.`);
		}
	}
	const body = buildReviewBody(reportPath, sameSession);
	appendSystem(`Reviewing implementation from ${reportPath}`);
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

/** Turn the raw assistant errorMessage into a readable line. Pi stores things
 *  like `400 {"type":"error","error":{"message":"…"}}` — pull out the human
 *  message + status code when present, else show the (truncated) raw string. */
function formatTurnError(raw: unknown): string {
	if (typeof raw !== "string" || !raw.trim()) return t("chat.error.generic");
	const braceAt = raw.indexOf("{");
	if (braceAt >= 0) {
		try {
			const j = JSON.parse(raw.slice(braceAt));
			const inner = j?.error?.message ?? j?.message;
			if (typeof inner === "string" && inner) {
				const status = raw.slice(0, braceAt).trim();
				return (status ? status + " — " : "") + inner;
			}
		} catch {
			/* not JSON — fall through */
		}
	}
	return raw.length > 500 ? raw.slice(0, 500) + "…" : raw;
}

